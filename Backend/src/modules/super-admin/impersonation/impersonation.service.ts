import crypto from 'crypto';
import { Request } from 'express';
import { Types } from 'mongoose';
import { env } from '../../../config/env';
import { TokenPayload, generateAccessToken, generateRefreshToken } from '../../../utils/tokens';
import { UserService } from '../../users/user.service';
import { User } from '../../users/user.model';
import { Company } from '../companies/company.model';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { SessionService } from '../../auth/session/session.service';
import { ImpersonationSession } from './impersonation.model';
import {
    ImpersonationStatus,
    ImpersonationStartResponse,
    ImpersonationStopResponse,
    CurrentImpersonationResponse,
} from './impersonation.types';

export class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

export class ImpersonationService {
    /**
     * Start a new impersonation session for a Super Admin targeting another user
     */
    static async startImpersonation(
        requester: TokenPayload,
        targetUserId: string,
        req?: Request
    ): Promise<ImpersonationStartResponse> {
        // ── 1. Validate Authenticated Super Admin Authorization ────────────────
        const actualActorId = requester.authUserId || requester.sessionUserId || requester.userId;

        const actualAdminUser = await UserService.findById(actualActorId);
        if (!actualAdminUser || !actualAdminUser.isActive) {
            throw new AppError('Super Admin user account not found or inactive', 401);
        }

        const actualAdminRole = (actualAdminUser.role as any)?.name || 'User';
        if (actualAdminRole !== 'SUPER_ADMIN') {
            throw new AppError('Only Super Admin can impersonate users.', 403);
        }

        // If Super Admin is already in an impersonation session, automatically close prior active sessions
        if (requester.isImpersonating || requester.sessionType === 'IMPERSONATION' || requester.impersonationSessionId) {
            await ImpersonationSession.updateMany(
                {
                    originalUserId: new Types.ObjectId(actualActorId),
                    status: ImpersonationStatus.ACTIVE,
                },
                {
                    $set: {
                        status: ImpersonationStatus.ENDED,
                        endedAt: new Date(),
                    },
                }
            );
        }

        // ── 2. Validate Target User ───────────────────────────────────────────

        if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
            throw new AppError('Target user not found', 404);
        }

        const targetUser = await UserService.findById(targetUserId);
        if (!targetUser) {
            throw new AppError('Target user not found', 404);
        }

        if (!targetUser.isActive || targetUser.status !== 'ACTIVE') {
            throw new AppError('Target user is inactive', 403);
        }

        const targetRoleName = (targetUser.role as any)?.name || 'User';
        const targetCompanyId = targetUser.companyId ? String(targetUser.companyId) : null;

        // Verify target company is not deleted/suspended if set
        if (targetCompanyId) {
            const company = await Company.findById(targetCompanyId);
            if (!company || company.status === 'DELETED' || !company.isActive) {
                throw new AppError('Target user organization is no longer active', 403);
            }
            if (company.status === 'SUSPENDED') {
                throw new AppError('Target user organization is suspended', 403);
            }
        }

        // ── 3. Create Impersonation Session ───────────────────────────────────
        const sessionId = crypto.randomUUID();
        const ttlMinutes = env.IMPERSONATION_SESSION_TTL_MINUTES || 30;
        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + ttlMinutes * 60 * 1000);

        const ipAddress = req
            ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null
            : null;
        const userAgent = req?.headers['user-agent'] || null;

        const session = new ImpersonationSession({
            sessionId,
            originalUserId: new Types.ObjectId(actualActorId),
            targetUserId: targetUser._id,
            targetCompanyId: targetUser.companyId || null,
            status: ImpersonationStatus.ACTIVE,
            startedAt,
            expiresAt,
            ipAddress,
            userAgent,
        });

        await session.save();

        // ── 4. Generate Dual Identity Tokens ──────────────────────────────────
        const payload: TokenPayload = {
            userId: String(targetUser._id),
            email: targetUser.email,
            role: targetRoleName,
            companyId: targetCompanyId || undefined,

            sub: String(targetUser._id),
            authUserId: actualActorId,
            effectiveUserId: String(targetUser._id),
            sessionUserId: actualActorId,
            isImpersonating: true,
            impersonationSessionId: sessionId,
            sessionType: 'IMPERSONATION',
            impersonatedBy: actualActorId,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // Store refresh token in AuthSession to support seamless rotation
        await SessionService.createSession({
            userId: targetUser._id,
            refreshToken,
            req,
        });

        // ── 5. Audit Logging ──────────────────────────────────────────────────
        await AuditLogService.log({
            action: AuditAction.IMPERSONATION_STARTED,
            actorId: actualActorId,
            actorEmail: actualAdminUser.email,
            actorRole: actualAdminRole,
            targetUserId: String(targetUser._id),
            targetEmail: targetUser.email,
            companyId: targetCompanyId,
            metadata: {
                sessionId,
                isImpersonating: true,
                expiresAt,
                targetRole: targetRoleName,
            },
            success: true,
            description: `Impersonation started by ${actualAdminUser.email} as ${targetUser.email}`,
            req,
        });

        return {
            isImpersonating: true,
            authenticatedUserId: actualActorId,
            impersonatedUserId: String(targetUser._id),
            companyId: targetCompanyId,
            role: targetRoleName,
            accessToken,
            refreshToken,
            session: {
                sessionId,
                expiresAt,
                startedAt,
            },
            user: {
                id: String(targetUser._id),
                name: targetUser.name,
                email: targetUser.email,
                role: targetRoleName,
                companyId: targetCompanyId,
            },
        };
    }

    /**
     * Terminate the active impersonation session and restore the original Super Admin session
     */
    static async stopImpersonation(
        requester: TokenPayload,
        req?: Request
    ): Promise<ImpersonationStopResponse> {
        if (!requester.isImpersonating && requester.sessionType !== 'IMPERSONATION') {
            throw new AppError('No active impersonation session found.', 400);
        }

        const actualAdminId = requester.authUserId || requester.sessionUserId;
        if (!actualAdminId) {
            throw new AppError('Original Super Admin context not found in session', 400);
        }

        // ── 1. End Impersonation Session in Database ──────────────────────────
        const sessionQuery: Record<string, any> = {
            status: ImpersonationStatus.ACTIVE,
        };

        if (requester.impersonationSessionId) {
            sessionQuery.sessionId = requester.impersonationSessionId;
        } else {
            sessionQuery.originalUserId = new Types.ObjectId(actualAdminId);
            sessionQuery.targetUserId = new Types.ObjectId(requester.userId);
        }

        const session = await ImpersonationSession.findOne(sessionQuery);
        if (session) {
            session.status = ImpersonationStatus.ENDED;
            session.endedAt = new Date();
            await session.save();
        }

        // ── 2. Restore Original Super Admin Context ───────────────────────────
        const adminUser = await UserService.findById(actualAdminId);
        if (!adminUser || !adminUser.isActive) {
            throw new AppError('Original Super Admin user account is no longer active', 401);
        }

        const adminRoleName = (adminUser.role as any)?.name || 'SUPER_ADMIN';

        const normalPayload: TokenPayload = {
            userId: String(adminUser._id),
            email: adminUser.email,
            role: adminRoleName,
            companyId: adminUser.companyId ? String(adminUser.companyId) : undefined,
            sub: String(adminUser._id),
            isImpersonating: false,
            sessionType: 'NORMAL',
        };

        const accessToken = generateAccessToken(normalPayload);
        const refreshToken = generateRefreshToken(normalPayload);

        await SessionService.createSession({
            userId: adminUser._id,
            refreshToken,
            req,
        });

        // ── 3. Audit Logging ──────────────────────────────────────────────────
        await AuditLogService.log({
            action: AuditAction.IMPERSONATION_ENDED,
            actorId: actualAdminId,
            actorEmail: adminUser.email,
            actorRole: adminRoleName,
            targetUserId: requester.userId,
            targetEmail: requester.email,
            companyId: adminUser.companyId ? String(adminUser.companyId) : null,
            metadata: {
                sessionId: session?.sessionId || requester.impersonationSessionId || null,
            },
            success: true,
            description: `Impersonation ended by ${adminUser.email}`,
            req,
        });

        return {
            isImpersonating: false,
            user: {
                id: String(adminUser._id),
                name: adminUser.name,
                email: adminUser.email,
                role: adminRoleName,
                companyId: adminUser.companyId ? String(adminUser.companyId) : null,
            },
            accessToken,
            refreshToken,
        };
    }

    /**
     * Retrieve the current impersonation status and details
     */
    static async getCurrentImpersonation(
        requester: TokenPayload
    ): Promise<CurrentImpersonationResponse> {
        if (!requester.isImpersonating && requester.sessionType !== 'IMPERSONATION') {
            return { isImpersonating: false };
        }

        let session: any = null;
        if (requester.impersonationSessionId) {
            session = await ImpersonationSession.findOne({
                sessionId: requester.impersonationSessionId,
            });
        }

        if (!session || session.status !== ImpersonationStatus.ACTIVE) {
            return { isImpersonating: false };
        }

        // Check if session has expired
        if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
            session.status = ImpersonationStatus.EXPIRED;
            session.endedAt = new Date();
            await session.save();

            await AuditLogService.log({
                action: AuditAction.IMPERSONATION_EXPIRED,
                actorId: String(session.originalUserId),
                targetUserId: String(session.targetUserId),
                companyId: session.targetCompanyId ? String(session.targetCompanyId) : null,
                metadata: { sessionId: session.sessionId },
                success: true,
                description: `Impersonation session ${session.sessionId} expired`,
            });

            return { isImpersonating: false };
        }

        const originalAdmin = await User.findById(session.originalUserId).populate('role');
        const targetUser = await User.findById(session.targetUserId).populate('role');

        let companyInfo: { id: string; name: string } | null = null;
        if (targetUser?.companyId) {
            const company = await Company.findById(targetUser.companyId);
            if (company) {
                companyInfo = { id: String(company._id), name: company.name };
            }
        }

        return {
            isImpersonating: true,
            originalUser: {
                id: String(session.originalUserId),
                email: originalAdmin?.email || '',
                role: (originalAdmin?.role as any)?.name || 'SUPER_ADMIN',
            },
            targetUser: {
                id: String(session.targetUserId),
                name: targetUser?.name || '',
                email: targetUser?.email || '',
                role: (targetUser?.role as any)?.name || requester.role,
            },
            company: companyInfo,
            startedAt: session.startedAt,
            expiresAt: session.expiresAt,
        };
    }
}

export default ImpersonationService;

