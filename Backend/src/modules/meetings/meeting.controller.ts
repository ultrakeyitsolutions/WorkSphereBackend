import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { sendSuccess, sendError } from '../../utils/response';
import { MeetingService } from './meeting.service';
import { MeetingSchedulingService } from './meeting-scheduling.service';
import {
    acceptMeetingSchema,
    rejectMeetingSchema,
    rescheduleRequestSchema,
    proposeRescheduleSchema,
    cancelMeetingSchema,
    meetingListQuerySchema,
    availabilityQuerySchema,
} from './meeting.validator';

export class MeetingController {
    /**
     * GET /api/meetings/my
     */
    public static async getMyMeetings(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsedQuery = meetingListQuerySchema.parse(req.query);
            const result = await MeetingService.getMyMeetings(companyId, userId, parsedQuery);

            return sendSuccess(res, 'My meetings retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch my meetings', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/assigned
     */
    public static async getAssignedMeetings(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsedQuery = meetingListQuerySchema.parse(req.query);
            const result = await MeetingService.getAssignedMeetings(companyId, userId, parsedQuery);

            return sendSuccess(res, 'Assigned meetings retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch assigned meetings', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/company
     */
    public static async getCompanyMeetings(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Authentication context missing company ID', 401);
            }

            const parsedQuery = meetingListQuerySchema.parse(req.query);
            const result = await MeetingService.getCompanyMeetings(companyId, parsedQuery);

            return sendSuccess(res, 'Company meetings retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch company meetings', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/upcoming
     */
    public static async getUpcomingMeetings(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const result = await MeetingService.getUpcomingMeetings(companyId, userId);
            return sendSuccess(res, 'Upcoming meetings retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch upcoming meetings', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/history
     */
    public static async getMeetingHistory(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsedQuery = meetingListQuerySchema.parse(req.query);
            const result = await MeetingService.getMeetingHistory(companyId, userId, parsedQuery);

            return sendSuccess(res, 'Meeting history retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch meeting history', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/availability
     */
    public static async getAvailability(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const defaultUserId = req.currentUser?.userId || req.user?.userId;
            if (!companyId) {
                return sendError(res, 'Authentication context missing company ID', 401);
            }

            const parsedQuery = availabilityQuerySchema.safeParse(req.query);
            if (!parsedQuery.success) {
                return sendError(res, 'Validation error', 422, parsedQuery.error.format());
            }

            const targetUserId = parsedQuery.data.userId || defaultUserId;
            if (!targetUserId) {
                return sendError(res, 'User ID is required for availability check', 400);
            }

            const result = await MeetingSchedulingService.getAvailability(
                companyId,
                targetUserId,
                parsedQuery.data.date,
                parsedQuery.data.durationMinutes
            );

            return sendSuccess(res, 'Availability retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch availability', error.statusCode || 500);
        }
    }

    /**
     * GET /api/meetings/:meetingId
     */
    public static async getMeetingById(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const userRole = req.currentUser?.role || req.user?.role || '';
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const result = await MeetingService.getMeetingById(
                meetingId,
                userId,
                companyId,
                userRole
            );

            return sendSuccess(res, 'Meeting details retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch meeting details', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/accept
     */
    public static async acceptMeeting(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = acceptMeetingSchema.safeParse(req.body);
            const note = parsed.success ? parsed.data.note : undefined;

            const result = await MeetingService.acceptMeeting(
                meetingId,
                userId,
                companyId,
                note,
                req
            );

            return sendSuccess(res, 'Meeting accepted successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to accept meeting', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/reject
     */
    public static async rejectMeeting(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = rejectMeetingSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Rejection reason is required', 422, parsed.error.format());
            }

            const result = await MeetingService.rejectMeeting(
                meetingId,
                userId,
                companyId,
                parsed.data.reason,
                req
            );

            return sendSuccess(res, 'Meeting rejected successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to reject meeting', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/reschedule-request
     */
    public static async requestReschedule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = rescheduleRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation error', 422, parsed.error.format());
            }

            const result = await MeetingService.requestReschedule(
                meetingId,
                userId,
                companyId,
                parsed.data.proposedStartAt,
                parsed.data.durationMinutes,
                parsed.data.reason,
                req
            );

            return sendSuccess(res, 'Meeting reschedule requested successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to request meeting reschedule', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/reschedule/accept
     */
    public static async acceptReschedule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const result = await MeetingService.acceptReschedule(
                meetingId,
                userId,
                companyId,
                req
            );

            return sendSuccess(res, 'Reschedule proposal accepted successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to accept reschedule proposal', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/reschedule/reject
     */
    public static async rejectReschedule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = rejectMeetingSchema.safeParse(req.body);
            const reason = parsed.success ? parsed.data.reason : undefined;

            const result = await MeetingService.rejectReschedule(
                meetingId,
                userId,
                companyId,
                reason,
                req
            );

            return sendSuccess(res, 'Reschedule proposal rejected successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to reject reschedule proposal', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/reschedule/propose
     */
    public static async proposeReschedule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = proposeRescheduleSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation error', 422, parsed.error.format());
            }

            const result = await MeetingService.proposeReschedule(
                meetingId,
                userId,
                companyId,
                parsed.data.proposedStartAt,
                parsed.data.durationMinutes,
                parsed.data.reason,
                req
            );

            return sendSuccess(res, 'Alternative reschedule time proposed successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to propose alternative time', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/join
     */
    public static async joinMeeting(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const userRole = req.currentUser?.role || req.user?.role || '';
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const result = await MeetingService.joinMeeting(
                meetingId,
                userId,
                companyId,
                userRole,
                req
            );

            return sendSuccess(res, 'Meeting joined successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to join meeting', error.statusCode || 500);
        }
    }

    /**
     * POST /api/meetings/:meetingId/cancel
     */
    public static async cancelMeeting(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;
            const userRole = req.currentUser?.role || req.user?.role || '';
            const meetingId = String(req.params.meetingId);

            if (!companyId || !userId) {
                return sendError(res, 'Authentication context missing', 401);
            }

            const parsed = cancelMeetingSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Cancellation reason is required', 422, parsed.error.format());
            }

            const result = await MeetingService.cancelMeeting(
                meetingId,
                userId,
                companyId,
                userRole,
                parsed.data.reason,
                req
            );

            return sendSuccess(res, 'Meeting cancelled successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to cancel meeting', error.statusCode || 500);
        }
    }
}
