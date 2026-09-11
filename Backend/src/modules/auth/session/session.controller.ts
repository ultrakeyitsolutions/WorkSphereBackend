import { Response } from 'express';
import { SessionService } from './session.service';
import { AuthenticatedRequest } from '../auth.types';
import { sendSuccess, sendError } from '../../../utils/response';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

export class SessionController {
    /**
     * GET /auth/sessions (Requires login)
     * List all active sessions for current user
     */
    static async getSessions(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const sessions = await SessionService.getUserSessions(userId);
            return sendSuccess(res, 'Active sessions retrieved successfully', sessions);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve sessions', 400);
        }
    }

    /**
     * DELETE /auth/sessions/:sessionId (Requires login)
     * Revoke a specific device session
     */
    static async revokeSession(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            const { sessionId } = req.params;

            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            if (!sessionId) {
                return sendError(res, 'Session ID is required', 400);
            }

            const idStr = Array.isArray(sessionId) ? sessionId[0] : sessionId;
            const success = await SessionService.revokeSessionById(userId, idStr);
            if (!success) {
                return sendError(res, 'Session not found or already revoked', 404);
            }

            await AuditLogService.log({
                action: AuditAction.SESSION_REVOKED,
                actorId: userId as any,
                actorEmail: req.user?.email || null,
                success: true,
                description: `Session revoked: ${sessionId}`,
                req,
            });

            return sendSuccess(res, 'Session revoked successfully');
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to revoke session', 400);
        }
    }

    /**
     * POST /auth/logout
     * Revoke current session using refresh token in body or header
     */
    static async logout(req: AuthenticatedRequest, res: Response) {
        try {
            const refreshToken = req.body?.refreshToken;
            if (refreshToken) {
                await SessionService.revokeSessionByToken(refreshToken);
            }

            if (req.user?.userId) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGOUT,
                    actorId: req.user.userId as any,
                    actorEmail: req.user.email,
                    success: true,
                    description: `User logged out: ${req.user.email}`,
                    req,
                });
            }

            return sendSuccess(res, 'Logged out successfully');
        } catch (error: any) {
            return sendError(res, error.message || 'Logout failed', 400);
        }
    }

    /**
     * POST /auth/logout-all
     * Revoke all sessions across all devices for this user
     */
    static async logoutAll(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const count = await SessionService.revokeAllUserSessions(userId);

            await AuditLogService.log({
                action: AuditAction.ALL_SESSIONS_REVOKED,
                actorId: userId as any,
                actorEmail: req.user?.email || null,
                success: true,
                description: `All active sessions revoked (${count} sessions) for: ${req.user?.email}`,
                req,
            });

            return sendSuccess(res, `Logged out from all ${count} devices successfully`);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to logout from all devices', 400);
        }
    }
}
