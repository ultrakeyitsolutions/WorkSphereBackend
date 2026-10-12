import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { LiveMonitoringService } from './services/live-monitoring.service';
import { MonitoringAlertService } from './services/monitoring-alert.service';

function getActor(req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    const email = req.user?.email ?? '';
    const role = req.user?.role ?? '';
    if (!userId || !companyId) {
        throw AppError.unauthorized('Unauthorized: Missing user context');
    }
    return { userId, companyId, email, role };
}

// ─── GET /api/v1/company/live-monitoring/overview ────────────────────────────
export const getOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const forceRefresh = req.query.forceRefresh === 'true';
    const overview = await LiveMonitoringService.getDashboardOverview(companyId, forceRefresh);
    return sendSuccess(res, 'Live monitoring overview retrieved successfully', overview);
});

// ─── GET /api/v1/company/live-monitoring/employees ───────────────────────────
export const getEmployees = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

    const result = await LiveMonitoringService.getLiveEmployees(companyId, {
        search: qs(req.query.search),
        teamId: qs(req.query.teamId),
        departmentId: qs(req.query.departmentId),
        projectId: qs(req.query.projectId),
        presence: qs(req.query.presence) as any,
        workStatus: qs(req.query.workStatus) as any,
        taskStatus: qs(req.query.taskStatus),
        sortBy: (qs(req.query.sortBy) as any) || 'lastActivity',
        sortOrder: (qs(req.query.sortOrder) as any) || 'desc',
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });

    return sendSuccess(res, 'Live employees retrieved successfully', result);
});

// ─── GET /api/v1/company/live-monitoring/employees/:employeeId ─────────────────
export const getEmployeeById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const employee = await LiveMonitoringService.getEmployeeLiveDetail(companyId, employeeId);
    return sendSuccess(res, 'Employee live detail retrieved successfully', employee);
});

// ─── GET /api/v1/company/live-monitoring/activity ────────────────────────────
export const getActivityFeed = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

    const result = await LiveMonitoringService.getActivityFeed(companyId, {
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        eventType: qs(req.query.eventType),
        employeeId: qs(req.query.employeeId),
        projectId: qs(req.query.projectId),
        from: qs(req.query.from),
        to: qs(req.query.to),
    });

    return sendSuccess(res, 'Activity feed retrieved successfully', result);
});

// ─── GET /api/v1/company/live-monitoring/projects ────────────────────────────
export const getProjects = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

    const result = await LiveMonitoringService.getLiveProjects(companyId, {
        status: qs(req.query.status),
        riskOnly: req.query.riskOnly === 'true',
        search: qs(req.query.search),
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });

    return sendSuccess(res, 'Live projects retrieved successfully', result);
});

// ─── GET /api/v1/company/live-monitoring/attendance ──────────────────────────
export const getAttendanceSnapshot = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

    const result = await LiveMonitoringService.getAttendanceSnapshot(companyId, {
        date: qs(req.query.date),
        teamId: qs(req.query.teamId),
        departmentId: qs(req.query.departmentId),
        status: qs(req.query.status) as any,
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });

    return sendSuccess(res, 'Attendance snapshot retrieved successfully', result);
});

// ─── GET /api/v1/company/live-monitoring/alerts ──────────────────────────────
export const getAlerts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const qs = (val: unknown): string | undefined =>
        typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

    const result = await MonitoringAlertService.getAlerts(companyId, {
        severity: qs(req.query.severity) as any,
        alertType: qs(req.query.alertType) as any,
        status: qs(req.query.status) as any,
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });

    return sendSuccess(res, 'Live alerts retrieved successfully', result);
});

// ─── PATCH /api/v1/company/live-monitoring/alerts/:alertId/acknowledge ────────
export const acknowledgeAlert = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId, userId } = getActor(req);
    const alertId = (req.params as Record<string, string>)['alertId'] ?? '';
    if (!alertId) {
        throw AppError.unprocessable('alertId is required');
    }

    const note = (req.body as { note?: string })?.note;
    const alert = await MonitoringAlertService.acknowledgeAlert(companyId, alertId, userId, note);
    return sendSuccess(res, 'Alert acknowledged successfully', alert);
});

// ─── PATCH /api/v1/company/live-monitoring/alerts/:alertId/resolve ────────────
export const resolveAlert = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId, userId } = getActor(req);
    const alertId = (req.params as Record<string, string>)['alertId'] ?? '';
    if (!alertId) {
        throw AppError.unprocessable('alertId is required');
    }

    const { note, resolutionReason } = (req.body as { note?: string; resolutionReason?: string }) || {};
    const alert = await MonitoringAlertService.resolveAlert(companyId, alertId, userId, note, resolutionReason);
    return sendSuccess(res, 'Alert resolved successfully', alert);
});

// ─── POST /api/v1/company/live-monitoring/alerts/evaluate ────────────────────
export const evaluateAlerts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const generatedAlerts = await MonitoringAlertService.evaluateAndGenerateAlerts(companyId);
    return sendSuccess(res, 'Alert evaluation completed', { count: generatedAlerts.length, alerts: generatedAlerts });
});
