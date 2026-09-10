import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { TimesheetService } from './timesheet.service';
import {
    timesheetQuerySchema,
    trendQuerySchema,
    comparisonQuerySchema,
    projectDistributionQuerySchema,
    anomaliesQuerySchema,
    timelineParamsSchema,
    submitTimesheetSchema,
    approvalParamsSchema,
    rejectTimesheetSchema,
    correctionSchema
} from './timesheet.validator';

/** Extract and validate companyId + userId from JWT. Throws 401 if absent. */
function requireAuth(req: AuthenticatedRequest): { companyId: string; userId: string; role: string } {
    const companyId = req.user?.companyId;
    const userId    = req.user?.userId;
    const role      = req.user?.role ?? '';

    if (!companyId || !userId) {
        throw AppError.unauthorized('Unauthorized');
    }
    return { companyId, userId, role };
}

export class TimesheetController {

    // ─── GET /timesheets ──────────────────────────────────────────────────────
    static getTimesheetData = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = timesheetQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { startDate, endDate, employeeId, projectId, page, pageSize } = parsed.data.query;

        const result = await TimesheetService.getTimesheetData(companyId, userId, role, {
            startDate: new Date(`${startDate}T00:00:00.000Z`),
            endDate:   new Date(`${endDate}T23:59:59.999Z`),
            employeeId,
            projectId,
            page,
            pageSize
        });

        sendSuccess(res, 'Timesheet retrieved successfully.', result);
    });

    // ─── GET /timesheets/trend ────────────────────────────────────────────────
    static getProductivityTrend = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = trendQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { startDate, endDate, employeeId, projectId } = parsed.data.query;

        const result = await TimesheetService.getProductivityTrend(companyId, userId, role, {
            startDate: new Date(`${startDate}T00:00:00.000Z`),
            endDate:   new Date(`${endDate}T23:59:59.999Z`),
            employeeId,
            projectId,
            page: 1,
            pageSize: 100
        });

        sendSuccess(res, 'Productivity trend retrieved successfully.', result);
    });

    // ─── GET /timesheets/comparison ───────────────────────────────────────────
    static comparePeriods = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = comparisonQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { currentStart, currentEnd, previousStart, previousEnd, employeeId } = parsed.data.query;

        const result = await TimesheetService.comparePeriods(
            companyId, userId, role,
            {
                startDate: new Date(`${currentStart}T00:00:00.000Z`),
                endDate:   new Date(`${currentEnd}T23:59:59.999Z`)
            },
            {
                startDate: new Date(`${previousStart}T00:00:00.000Z`),
                endDate:   new Date(`${previousEnd}T23:59:59.999Z`)
            },
            employeeId
        );

        sendSuccess(res, 'Period comparison retrieved successfully.', result);
    });

    // ─── GET /timesheets/project-distribution ─────────────────────────────────
    static getProjectDistribution = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = projectDistributionQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { startDate, endDate, employeeId } = parsed.data.query;

        const result = await TimesheetService.getProjectDistribution(companyId, userId, role, {
            startDate: new Date(`${startDate}T00:00:00.000Z`),
            endDate:   new Date(`${endDate}T23:59:59.999Z`),
            employeeId,
            page: 1,
            pageSize: 100
        });

        sendSuccess(res, 'Project distribution retrieved successfully.', result);
    });

    // ─── GET /timesheets/anomalies ────────────────────────────────────────────
    static getAnomalies = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = anomaliesQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { startDate, endDate, employeeId } = parsed.data.query;

        const result = await TimesheetService.getAnomalies(companyId, userId, role, {
            startDate: new Date(`${startDate}T00:00:00.000Z`),
            endDate:   new Date(`${endDate}T23:59:59.999Z`),
            employeeId,
            page: 1,
            pageSize: 100
        });

        sendSuccess(res, 'Anomalies retrieved successfully.', result);
    });

    // ─── GET /timesheets/timeline/:date ───────────────────────────────────────
    /**
     * Security rules:
     *   Member:  JWT userId used automatically. employeeId param is ignored.
     *   Admin:   employeeId query param used to view another employee's timeline.
     *            If omitted, admin sees their own timeline.
     */
    static getTimeline = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        const parsed = timelineParamsSchema.safeParse({ params: req.params, query: req.query });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { date }       = parsed.data.params;
        const { employeeId } = parsed.data.query;
        const isAdmin        = TimesheetService.isAdminRole(role);

        // Member: always own timeline. Admin: use employeeId if supplied, else own.
        const targetUserId = isAdmin && employeeId ? employeeId : userId;

        const result = await TimesheetService.getTimeline(companyId, userId, role, targetUserId, date);

        sendSuccess(res, 'Timeline retrieved successfully.', result);
    });

    // ─── POST /timesheets/submit ──────────────────────────────────────────────
    static submitTimesheet = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId } = requireAuth(req);

        const parsed = submitTimesheetSchema.safeParse({ body: req.body });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const { periodStart, periodEnd } = parsed.data.body;

        const result = await TimesheetService.submitTimesheet(companyId, userId, periodStart, periodEnd);

        sendSuccess(res, 'Timesheet submitted successfully.', result, 201);
    });

    // ─── POST /timesheets/:id/approve ─────────────────────────────────────────
    static approveTimesheet = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        if (role !== 'Admin' && role !== 'SUPER_ADMIN') {
            throw AppError.forbidden('ADMIN_REQUIRED');
        }

        const parsed = approvalParamsSchema.safeParse({ params: req.params });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const result = await TimesheetService.reviewTimesheet(
            companyId, userId, parsed.data.params.id, 'APPROVE'
        );

        sendSuccess(res, 'Timesheet approved successfully.', result);
    });

    // ─── POST /timesheets/:id/reject ──────────────────────────────────────────
    static rejectTimesheet = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        if (role !== 'Admin' && role !== 'SUPER_ADMIN') {
            throw AppError.forbidden('ADMIN_REQUIRED');
        }

        const parsed = rejectTimesheetSchema.safeParse({ params: req.params, body: req.body });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const result = await TimesheetService.reviewTimesheet(
            companyId, userId, parsed.data.params.id, 'REJECT', parsed.data.body.reason
        );

        sendSuccess(res, 'Timesheet rejected.', result);
    });

    // ─── POST /timesheets/:id/lock ────────────────────────────────────────────
    static lockTimesheet = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        if (role !== 'Admin' && role !== 'SUPER_ADMIN') {
            throw AppError.forbidden('ADMIN_REQUIRED');
        }

        const parsed = approvalParamsSchema.safeParse({ params: req.params });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const result = await TimesheetService.reviewTimesheet(
            companyId, userId, parsed.data.params.id, 'LOCK'
        );

        sendSuccess(res, 'Timesheet locked.', result);
    });

    // ─── POST /timesheets/correction ──────────────────────────────────────────
    static createCorrection = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, role } = requireAuth(req);

        if (role !== 'Admin' && role !== 'SUPER_ADMIN') {
            throw AppError.forbidden('ADMIN_REQUIRED');
        }

        const parsed = correctionSchema.safeParse({ body: req.body });
        if (!parsed.success) {
            throw AppError.badRequest(parsed.error.issues.map((e: any) => e.message).join('; '));
        }

        const result = await TimesheetService.createCorrection(
            companyId,
            userId,
            parsed.data.body,
            req
        );

        sendSuccess(res, 'Correction recorded successfully.', result, 201);
    });
}
