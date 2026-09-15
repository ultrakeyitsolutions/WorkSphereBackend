import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess, sendError } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { CalendarService } from './calendar.service';
import { CalendarOAuthService } from './calendar-oauth.service';
import {
    createCalendarEventSchema,
    updateCalendarEventSchema,
    rescheduleEventSchema,
    rsvpSchema,
    quickMeetingSchema,
    connectOAuthSchema,
} from './calendar.validation';

export class CalendarController {
    /**
     * GET /api/v1/company/calendar/events
     */
    static getEvents = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Company context not found in session');

        const { startDate, endDate, projectId, provider, status, search } = req.query;

        const events = await CalendarService.getEvents(companyId, {
            startDate: startDate as string,
            endDate: endDate as string,
            projectId: projectId as string,
            provider: provider as string,
            status: status as string,
            search: search as string,
        });

        return sendSuccess(res, 'Calendar events retrieved successfully', events, 200);
    });

    /**
     * POST /api/v1/company/calendar/events
     */
    static createEvent = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId || !req.user) throw AppError.unauthorized('Unauthorized');

        const parsed = createCalendarEventSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        try {
            const event = await CalendarService.createEvent(companyId, req.user, parsed.data);
            return sendSuccess(res, 'Calendar event created successfully', event, 201);
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * PUT /api/v1/company/calendar/events/:id
     */
    static updateEvent = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId || !req.user) throw AppError.unauthorized('Unauthorized');

        const id = req.params.id as string;
        const parsed = updateCalendarEventSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        try {
            const event = await CalendarService.updateEvent(companyId, req.user, id, parsed.data);
            return sendSuccess(res, 'Calendar event updated successfully', event, 200);
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * PATCH /api/v1/company/calendar/events/:id/reschedule
     */
    static rescheduleEvent = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId || !req.user) throw AppError.unauthorized('Unauthorized');

        const id = req.params.id as string;
        const parsed = rescheduleEventSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        try {
            const event = await CalendarService.rescheduleEvent(
                companyId,
                req.user,
                id,
                parsed.data
            );
            return sendSuccess(res, 'Event rescheduled successfully', event, 200);
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * PATCH /api/v1/company/calendar/events/:id/rsvp
     */
    static rsvpEvent = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const id = req.params.id as string;
        const parsed = rsvpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        try {
            const data = await CalendarService.rsvpEvent(companyId, userId, id, parsed.data);
            return sendSuccess(res, 'Response recorded successfully', data, 200);
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * DELETE /api/v1/company/calendar/events/:id
     */
    static deleteEvent = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId || !req.user) throw AppError.unauthorized('Unauthorized');

        const id = req.params.id as string;
        try {
            await CalendarService.deleteEvent(companyId, req.user, id);
            return res.status(200).json({
                success: true,
                message: 'Calendar event cancelled successfully',
            });
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * POST /api/v1/company/calendar/quick-meeting
     */
    static quickMeeting = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId || !req.user) throw AppError.unauthorized('Unauthorized');

        const parsed = quickMeetingSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        try {
            const data = await CalendarService.quickMeeting(companyId, req.user, parsed.data);
            return sendSuccess(res, 'Quick meeting room created', data, 201);
        } catch (error: any) {
            if (error.details) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    message: error.message,
                    details: error.details,
                });
            }
            throw error;
        }
    });

    /**
     * GET /api/v1/company/calendar/entitlements
     */
    static getEntitlements = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const data = await CalendarService.getCalendarEntitlements(companyId);
        return sendSuccess(res, 'Calendar entitlements retrieved successfully', data, 200);
    });

    /**
     * GET /api/v1/company/calendar/oauth/status
     */
    static getOAuthStatus = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const data = await CalendarOAuthService.getIntegrationStatus(companyId, userId);
        return res.status(200).json({
            success: true,
            data,
        });
    });

    /**
     * POST /api/v1/company/calendar/oauth/:provider/connect
     */
    static connectOAuth = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const provider = req.params.provider as string;
        const parsed = connectOAuthSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation Error',
                details: parsed.error.format(),
            });
        }

        const data = await CalendarOAuthService.connectProvider(
            companyId,
            userId,
            provider,
            parsed.data.code,
            parsed.data.redirectUri
        );

        return sendSuccess(res, 'Integration connected successfully', data, 200);
    });

    /**
     * DELETE /api/v1/company/calendar/oauth/:provider/disconnect
     */
    static disconnectOAuth = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const provider = req.params.provider as string;
        await CalendarOAuthService.disconnectProvider(companyId, userId, provider);

        return res.status(200).json({
            success: true,
            message: 'Integration disconnected successfully',
        });
    });
}
export default CalendarController;
