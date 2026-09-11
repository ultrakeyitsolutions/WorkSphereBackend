import { UserService } from '../users/user.service';
import { Role } from '../roles/role.model';
import { Company } from '../super-admin/companies/company.model';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/tokens';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { Request } from 'express';
import { CompanyProfileService } from '../companyadmin/profile/company-profile.service';
import { MfaService } from './mfa/mfa.service';
import { SessionService } from './session/session.service';


export class AuthService {
    static async register(data: any) {
        const existingUser = await UserService.findByEmail(data.email);
        if (existingUser) {
            throw new Error('Email is already registered');
        }

        // Role resolution or creation
        const roleName = data.roleName || 'User';
        let role = await Role.findOne({ name: roleName });
        if (!role) {
            role = new Role({ name: roleName });
            await role.save();
        }

        const hashedPassword = await hashPassword(data.password);
        const user = await UserService.createUser({
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: role._id as any,
            isActive: true,
        });

        return user;
    }

    static async login(data: any, req?: Request) {
        const user = await UserService.findByEmail(data.email);
        if (!user) {
            // Log failed login attempt
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorEmail: data.email,
                success: false,
                description: `Failed login attempt for email: ${data.email} — user not found`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        if (!user.isActive) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                success: false,
                description: `Failed login — account deactivated for: ${user.email}`,
                req,
            });
            throw new Error('Your account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    success: false,
                    description: `Failed login — organization not found for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization suspended for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization inactive for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is no longer active.');
            }
            companyDoc = company;
        }

        const isMatch = await comparePassword(data.password, user.password || '');
        if (!isMatch) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: `Failed login — wrong password for: ${user.email}`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        // ─── MFA Gate ────────────────────────────────────────────────────────────
        if (user.mfaEnabled) {
            const challengeId = await MfaService.createChallenge(user._id, 'LOGIN');
            return {
                status: 'MFA_REQUIRED',
                challengeId,
            };
        }

        return this.generateAuthSessionResponse(user, req, null, companyDoc);
    }

    /**
     * Common helper to issue tokens, create an authentication session, and build the auth response
     */
    static async generateAuthSessionResponse(
        user: any,
        req?: Request,
        mfaVerifiedAt?: Date | null,
        existingCompanyDoc?: any
    ) {
        let companyDoc = existingCompanyDoc;
        if (!companyDoc && user.companyId) {
            companyDoc = await Company.findById(user.companyId);
        }

        const userRole = (user.role as any)?.name || 'User';

        const rolePermissions = ((user.role as any)?.permissions || []).map((p: any) => p.name).filter(Boolean);
        const grantedPermissions = ((user as any).grantedPermissions || []).map((p: any) => p.name).filter(Boolean);
        const revokedPermissions = ((user as any).revokedPermissions || []).map((p: any) => p.name).filter(Boolean);

        const effectivePermissionsSet = new Set(rolePermissions);
        grantedPermissions.forEach((p: string) => effectivePermissionsSet.add(p));
        revokedPermissions.forEach((p: string) => effectivePermissionsSet.delete(p));
        const finalPermissions = Array.from(effectivePermissionsSet);

        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // ─── Create Auth Session ─────────────────────────────────────────────
        await SessionService.createSession({
            userId: user._id,
            refreshToken,
            mfaVerifiedAt: mfaVerifiedAt || (user.mfaEnabled ? new Date() : null),
            req,
        });

        // ─── Successful login audit ──────────────────────────────────────────
        await AuditLogService.log({
            action: AuditAction.USER_LOGIN,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `User logged in: ${user.email}`,
            req,
        });

        const subscriptionData = companyDoc
            ? await CompanyProfileService.getCompanySubscription(String(companyDoc._id))
            : null;

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                permissions: finalPermissions,
                companyId: user.companyId,
                mfaEnabled: !!user.mfaEnabled,
            },
            company: companyDoc
                ? {
                    id: String(companyDoc._id),
                    name: companyDoc.name,
                    slug: companyDoc.slug,
                    domain: companyDoc.domain || null,
                    industry: companyDoc.industry || null,
                    size: companyDoc.size || null,
                    logoUrl: companyDoc.logoUrl || null,
                    companyEmail: companyDoc.companyEmail || null,
                    companyPhone: companyDoc.companyPhone || null,
                    website: companyDoc.website || null,
                    address: companyDoc.address || null,
                    city: companyDoc.city || null,
                    state: companyDoc.state || null,
                    country: companyDoc.country || null,
                    postalCode: companyDoc.postalCode || null,
                    timezone: companyDoc.timezone || null,
                    currency: companyDoc.currency || null,
                    status: companyDoc.status,
                    isActive: companyDoc.isActive,
                    subscription: subscriptionData,
                    createdAt: (companyDoc as any).createdAt,
                    updatedAt: (companyDoc as any).updatedAt,
                }
                : null,
            accessToken,
            refreshToken,
        };
    }

    static async refresh(token: string, req?: Request) {
        // Validate against active database session
        const activeSession = await SessionService.validateSession(token);
        if (!activeSession) {
            throw new Error('Session is invalid or has been revoked. Please log in again.');
        }

        const decoded = verifyRefreshToken(token);
        const user = await UserService.findById(decoded.userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (!user.isActive) {
            throw new Error('User account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                throw new Error('Your organization account is no longer active.');
            }
            companyDoc = company;
        }

        const userRole = (user.role as any)?.name || 'User';

        const rolePermissions = ((user.role as any)?.permissions || []).map((p: any) => p.name).filter(Boolean);
        const grantedPermissions = ((user as any).grantedPermissions || []).map((p: any) => p.name).filter(Boolean);
        const revokedPermissions = ((user as any).revokedPermissions || []).map((p: any) => p.name).filter(Boolean);
        
        const effectivePermissionsSet = new Set(rolePermissions);
        grantedPermissions.forEach((p: string) => effectivePermissionsSet.add(p));
        revokedPermissions.forEach((p: string) => effectivePermissionsSet.delete(p));
        const finalPermissions = Array.from(effectivePermissionsSet);

        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        // ─── Rotate Refresh Token in Session ─────────────────────────────────
        await SessionService.rotateSessionToken(token, newRefreshToken);

        // Token refresh is the closest thing to a "logout + re-login" we track
        await AuditLogService.log({
            action: AuditAction.USER_LOGOUT,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Token refreshed (session continued) for: ${user.email}`,
            metadata: { note: 'Token refresh — previous session rotated' },
            req,
        });

        const subscriptionData = companyDoc
            ? await CompanyProfileService.getCompanySubscription(String(companyDoc._id))
            : null;

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                permissions: finalPermissions,
                companyId: user.companyId,
                mfaEnabled: !!user.mfaEnabled,
            },
            company: companyDoc
                ? {
                    id: String(companyDoc._id),
                    name: companyDoc.name,
                    slug: companyDoc.slug,
                    domain: companyDoc.domain || null,
                    industry: companyDoc.industry || null,
                    size: companyDoc.size || null,
                    logoUrl: companyDoc.logoUrl || null,
                    companyEmail: companyDoc.companyEmail || null,
                    companyPhone: companyDoc.companyPhone || null,
                    website: companyDoc.website || null,
                    address: companyDoc.address || null,
                    city: companyDoc.city || null,
                    state: companyDoc.state || null,
                    country: companyDoc.country || null,
                    postalCode: companyDoc.postalCode || null,
                    timezone: companyDoc.timezone || null,
                    currency: companyDoc.currency || null,
                    status: companyDoc.status,
                    isActive: companyDoc.isActive,
                    subscription: subscriptionData,
                    createdAt: (companyDoc as any).createdAt,
                    updatedAt: (companyDoc as any).updatedAt,
                }
                : null,
            accessToken,
            refreshToken: newRefreshToken,
        };
    }
}
