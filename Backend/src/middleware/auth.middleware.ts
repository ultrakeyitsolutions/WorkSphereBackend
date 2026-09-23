import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokens';
import { sendError } from '../utils/response';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { User } from '../modules/users/user.model';
import { Company } from '../modules/super-admin/companies/company.model';
import { ImpersonationSession } from '../modules/super-admin/impersonation/impersonation.model';
import { ImpersonationStatus } from '../modules/super-admin/impersonation/impersonation.types';
import { AuditLogService } from '../modules/audit-logs/audit-log.service';
import { AuditAction } from '../modules/audit-logs/audit-log.types';

export const authenticate = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 'Authorization token is required', 401);
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return sendError(res, 'Authorization token is required', 401);
        }

        const decoded = verifyAccessToken(token);
        req.user = decoded;

        // ── 1. Check if token represents an impersonation session ────────────
        if (
            decoded.isImpersonating ||
            decoded.sessionType === 'IMPERSONATION' ||
            decoded.impersonationSessionId
        ) {
            let session: any = null;
            if (decoded.impersonationSessionId) {
                session = await ImpersonationSession.findOne({
                    sessionId: decoded.impersonationSessionId,
                });
            } else {
                const authUserId = decoded.authUserId || decoded.sessionUserId;
                if (authUserId) {
                    session = await ImpersonationSession.findOne({
                        originalUserId: authUserId,
                        targetUserId: decoded.userId,
                    }).sort({ startedAt: -1 });
                }
            }

            if (!session) {
                return sendError(res, 'Impersonation session not found or invalid', 401);
            }

            if (session.status === ImpersonationStatus.ENDED) {
                return sendError(res, 'Impersonation session has ended', 401);
            }

            // Verify session expiration against authoritative database record
            if (
                session.status === ImpersonationStatus.EXPIRED ||
                (session.expiresAt && session.expiresAt.getTime() <= Date.now())
            ) {
                if (session.status !== ImpersonationStatus.EXPIRED) {
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
                        req,
                    });
                }
                return sendError(res, 'Impersonation session has expired', 401);
            }

            // Verify original Super Admin identity
            const actualAdmin = await (User.findById(session.originalUserId) as any).populate('role');
            if (!actualAdmin || !actualAdmin.isActive) {
                return sendError(res, 'Original administrator account is inactive', 401);
            }

            // Verify target user identity and status
            const targetUser = await (User.findById(session.targetUserId) as any).populate('role');
            if (!targetUser) {
                return sendError(res, 'Target user not found', 401);
            }
            if (!targetUser.isActive || targetUser.status !== 'ACTIVE') {
                return sendError(res, 'Target user account is deactivated', 401);
            }

            // Verify target company status
            if (targetUser.companyId) {
                const company = await Company.findById(targetUser.companyId);
                if (!company) {
                    return sendError(res, 'Organization not found', 401);
                }
                if (company.status === 'SUSPENDED') {
                    return sendError(res, 'Your organization account is currently suspended.', 403);
                }
                if (company.status === 'DELETED' || !company.isActive) {
                    return sendError(res, 'Your organization account is no longer active.', 403);
                }
            }

            const actualAdminRole = (actualAdmin.role as any)?.name || 'SUPER_ADMIN';
            const targetRoleName = (targetUser.role as any)?.name || decoded.role;

            // Dual Identity Context Attachment
            req.authenticatedUser = {
                userId: String(actualAdmin._id),
                email: actualAdmin.email,
                role: actualAdminRole,
            };

            req.currentUser = {
                userId: String(targetUser._id),
                email: targetUser.email,
                role: targetRoleName,
                companyId: targetUser.companyId ? String(targetUser.companyId) : undefined,
            };

            req.isImpersonating = true;
            req.impersonationSessionId = session.sessionId;

            return next();
        }

        // ── 2. Standard (Non-Impersonated) Authentication Flow ────────────────
        req.authenticatedUser = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
        };

        req.currentUser = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            companyId: decoded.companyId,
        };

        req.isImpersonating = false;

        // Perform backend check on company & user status for non-SUPER_ADMIN users
        if (decoded.role !== 'SUPER_ADMIN') {
            const user = await (User.findById(decoded.userId) as any).populate('role');
            if (!user) {
                return sendError(res, 'User context not found', 401);
            }
            if (!user.isActive || user.status === 'INACTIVE' || user.status === 'DEACTIVATED') {
                return sendError(res, 'User account is deactivated', 401);
            }
            if (user.companyId) {
                const company = await Company.findById(user.companyId);
                if (!company) {
                    return sendError(res, 'Organization not found', 401);
                }
                if (company.status === 'SUSPENDED') {
                    return sendError(res, 'Your organization account is currently suspended.', 403);
                }
                if (company.status === 'DELETED' || !company.isActive) {
                    return sendError(res, 'Your organization account is no longer active.', 403);
                }
            }
        }

        return next();
    } catch {
        return sendError(res, 'Token is invalid or expired', 401);
    }
};

export default authenticate;

