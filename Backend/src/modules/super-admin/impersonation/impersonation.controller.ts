import { Response } from 'express';
import { sendSuccess, sendError } from '../../../utils/response';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { ImpersonationService, AppError } from './impersonation.service';

export class ImpersonationController {
    /**
     * Start impersonation session
     * POST /api/superadmin/impersonation/start
     */
    static async start(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            const targetUserId = req.body?.targetUserId || (req.params?.userId as string);
            if (!targetUserId) {
                return sendError(res, 'Target user ID is required', 400);
            }

            const result = await ImpersonationService.startImpersonation(
                requester,
                targetUserId,
                req
            );

            return sendSuccess(res, 'Impersonation started successfully', result, 200);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to start impersonation', statusCode);
        }
    }

    /**
     * Stop active impersonation session and restore Super Admin session
     * POST /api/superadmin/impersonation/stop
     */
    static async stop(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            if (!req.isImpersonating && requester.sessionType !== 'IMPERSONATION') {
                return sendError(res, 'No active impersonation session found.', 400);
            }

            const result = await ImpersonationService.stopImpersonation(requester, req);

            return sendSuccess(res, 'Impersonation ended successfully', result, 200);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to stop impersonation', statusCode);
        }
    }

    /**
     * Get current impersonation status & session details
     * GET /api/superadmin/impersonation/current
     */
    static async current(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            const details = await ImpersonationService.getCurrentImpersonation(requester);

            return sendSuccess(res, 'Impersonation status retrieved', details, 200);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to retrieve impersonation status', statusCode);
        }
    }
}
