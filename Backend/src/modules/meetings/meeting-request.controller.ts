import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { sendSuccess, sendError } from '../../utils/response';
import { MeetingRequestService } from './meeting-request.service';
import { createMeetingRequestSchema } from './meeting.validator';

export class MeetingRequestController {
    /**
     * POST /api/meetings/requests
     */
    public static async createRequest(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing company or user ID', 401);
            }

            const parsed = createMeetingRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation error', 422, parsed.error.format());
            }

            const result = await MeetingRequestService.createRequest(
                companyId,
                userId,
                parsed.data,
                req
            );

            return sendSuccess(
                res,
                'Meeting request sent successfully',
                result,
                201
            );
        } catch (error: any) {
            const statusCode = error.statusCode || 500;
            const message = error.message || 'Failed to create meeting request';
            return sendError(res, message, statusCode, error.code ? { code: error.code } : undefined);
        }
    }

    /**
     * GET /api/meetings/requests/pending
     */
    public static async getPendingRequests(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing company or user ID', 401);
            }

            const requests = await MeetingRequestService.getPendingRequests(companyId, userId);
            return sendSuccess(res, 'Pending meeting requests retrieved successfully', {
                requests,
                count: requests.length,
            });
        } catch (error: any) {
            const statusCode = error.statusCode || 500;
            return sendError(res, error.message || 'Failed to fetch pending meeting requests', statusCode);
        }
    }
}
