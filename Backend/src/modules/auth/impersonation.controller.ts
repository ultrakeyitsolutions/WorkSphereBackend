import { Response } from 'express';
import { sendSuccess, sendError } from '../../utils/response';
import { AuthenticatedRequest } from './auth.types';
import { ImpersonationService } from './impersonation.service';

export class ImpersonationController {
    static async start(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            const targetUserId = req.params.userId as string;
            if (!targetUserId) {
                return sendError(res, 'Target User ID is required', 400);
            }

            const result = await ImpersonationService.startImpersonation(
                requester,
                targetUserId,
                req
            );

            return sendSuccess(res, 'Impersonation started successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to start impersonation', 403);
        }
    }

    static async stop(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            // Only stop if currently impersonating
            if (requester.sessionType !== 'IMPERSONATION' || !requester.sessionUserId) {
                throw new Error('You are not currently impersonating another user.');
            }

            const result = await ImpersonationService.stopImpersonation(
                requester,
                req
            );

            return sendSuccess(res, 'Impersonation stopped successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to stop impersonation', 400);
        }
    }

    static async getSession(req: AuthenticatedRequest, res: Response) {
        try {
            const requester = req.user;
            if (!requester) {
                return sendError(res, 'User context not found', 401);
            }

            const sessionDetails = await ImpersonationService.getSessionDetails(requester);
            return sendSuccess(res, 'Session details retrieved', sessionDetails);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get session details', 400);
        }
    }
}
