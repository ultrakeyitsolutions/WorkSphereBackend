import { Request } from 'express';
import { generateAccessToken, generateRefreshToken, TokenPayload } from '../../utils/tokens';
import { UserService } from '../users/user.service';
import { Company } from '../super-admin/companies/company.model';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';

export class ImpersonationService {
    static async startImpersonation(
        requester: TokenPayload,
        targetUserId: string,
        req?: Request
    ) {
        // Find target user
        const targetUser = await UserService.findById(targetUserId);
        if (!targetUser) {
            throw new Error('Target user not found');
        }

        if (!targetUser.isActive || targetUser.status !== 'ACTIVE') {
            throw new Error('Target user account is not active');
        }

        const targetRoleName = (targetUser.role as any)?.name || 'User';

        // ─── Security Checks ──────────────────────────────────────────────────
        // Who is actually trying to impersonate? (In case they are already impersonating, get root user)
        const actualActorId = requester.sessionType === 'IMPERSONATION' ? requester.sessionUserId : requester.userId;
        const actualActorUser = await UserService.findById(actualActorId!);
        if (!actualActorUser) throw new Error('Actor user not found');
        
        const actualActorRoleDesc = actualActorUser.role as any;
        const actualActorRole = actualActorRoleDesc?.name || 'User';
        const actualActorPermissions = (actualActorRoleDesc?.permissions || []).map(
            (p: any) => typeof p === 'object' ? p.name : p
        );
        
        let allowed = false;

        if (actualActorRole === 'SUPER_ADMIN') {
            allowed = true; // Super admins can impersonate anyone
        } else {
            // Must belong to the same company
            if (String(targetUser.companyId) !== String(actualActorUser.companyId)) {
                throw new Error('Target user does not belong to your organization');
            }

            // Cannot impersonate another company admin or super admin
            if (targetRoleName === 'COMPANY_ADMIN' || targetRoleName === 'SUPER_ADMIN') {
                throw new Error('You cannot impersonate an administrator');
            }

            // Check role permissions: if COMPANY_ADMIN, allowed by default. Else check explicitly.
            if (actualActorRole === 'COMPANY_ADMIN') {
                allowed = true;
            } else if (actualActorPermissions.includes('users.impersonate')) {
                allowed = true;
            }
        }

        if (!allowed) {
            throw new Error('You do not have permission to impersonate users');
        }

        // Generate tokens representing the impersonated session
        const payload: TokenPayload = {
            userId: String(targetUser._id),
            email: targetUser.email,
            role: targetRoleName,
            companyId: targetUser.companyId ? String(targetUser.companyId) : undefined,

            // Impersonation specific
            sessionUserId: actualActorId,
            effectiveUserId: String(targetUser._id),
            sessionType: 'IMPERSONATION',
            impersonatedBy: actualActorId,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.IMPERSONATION_STARTED,
            actorId: actualActorId!,
            targetUserId: targetUser._id as any,
            targetEmail: targetUser.email,
            companyId: targetUser.companyId as any,
            success: true,
            description: `Impersonation started for user ${targetUser.email}`,
            req,
        });

        return {
            user: {
                id: targetUser._id,
                name: targetUser.name,
                email: targetUser.email,
                role: targetRoleName,
                companyId: targetUser.companyId,
            },
            accessToken,
            refreshToken,
        };
    }

    static async stopImpersonation(
        requester: TokenPayload,
        req?: Request
    ) {
        if (!requester.sessionUserId) {
            throw new Error('Not currently in an impersonation session');
        }

        // Fetch original admin
        const adminUser = await UserService.findById(requester.sessionUserId);
        if (!adminUser || !adminUser.isActive) {
            throw new Error('Original admin user account is no longer active');
        }

        const adminRoleName = (adminUser.role as any)?.name || 'User';

        // Check if company is still active (if applicable)
        if (adminUser.companyId) {
            const company = await Company.findById(adminUser.companyId);
            if (!company || !company.isActive || company.status !== 'ACTIVE') {
                throw new Error('Organization account is no longer active');
            }
        }

        const payload: TokenPayload = {
            userId: String(adminUser._id),
            email: adminUser.email,
            role: adminRoleName,
            companyId: adminUser.companyId ? String(adminUser.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.IMPERSONATION_ENDED,
            actorId: String(adminUser._id),
            targetUserId: requester.effectiveUserId as any,
            companyId: adminUser.companyId as any,
            success: true,
            description: `Impersonation ended by admin for target user ${requester.email}`,
            req,
        });

        return {
            user: {
                id: adminUser._id,
                name: adminUser.name,
                email: adminUser.email,
                role: adminRoleName,
                companyId: adminUser.companyId,
            },
            accessToken,
            refreshToken,
        };
    }

    static async getSessionDetails(requester: TokenPayload) {
        // Base case: Not impersonating
        if (requester.sessionType !== 'IMPERSONATION' || !requester.sessionUserId) {
            const user = await UserService.findById(requester.userId);
            let companyInfo = null;
            if (user?.companyId) {
                const company = await Company.findById(user.companyId);
                if (company) {
                    companyInfo = { id: company._id, name: company.name };
                }
            }

            return {
                authenticatedUser: {
                    id: requester.userId,
                    role: requester.role,
                },
                effectiveUser: {
                    id: requester.userId,
                    name: user?.name,
                    role: requester.role,
                },
                impersonating: false,
                company: companyInfo,
            };
        }

        // Impersonation scenario
        const adminUser = await UserService.findById(requester.sessionUserId);
        const effectiveUser = await UserService.findById(requester.effectiveUserId!);

        let companyInfo = null;
        if (effectiveUser?.companyId) {
            const company = await Company.findById(effectiveUser.companyId);
            if (company) {
                companyInfo = { id: company._id, name: company.name };
            }
        }

        return {
            authenticatedUser: {
                id: requester.sessionUserId,
                role: (adminUser?.role as any)?.name || 'Unknown',
            },
            effectiveUser: {
                id: requester.effectiveUserId,
                name: effectiveUser?.name,
                role: requester.role,
            },
            impersonating: true,
            company: companyInfo,
        };
    }

    private static async getUserRoleName(userId: string): Promise<string> {
        const user = await UserService.findById(userId);
        if (!user) return 'User';
        return (user.role as any)?.name || 'User';
    }
}
