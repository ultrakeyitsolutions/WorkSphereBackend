import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { DetailedMonitoringService } from './detailed-monitoring.service';
import { MonitoringAlertService } from '../live-monitoring/services/monitoring-alert.service';

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

const qs = (val: unknown): string | undefined =>
    typeof val === 'string' ? val : Array.isArray(val) ? (val[0] as string) : undefined;

// ─── 1. Employee Directory ──────────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees
export const getEmployeesDirectory = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);

    const result = await DetailedMonitoringService.getEmployeeDirectory(companyId, {
        search: qs(req.query.search),
        departmentId: qs(req.query.departmentId),
        roleId: qs(req.query.roleId),
        projectId: qs(req.query.projectId),
        presence: qs(req.query.presence) as any,
        attendanceStatus: qs(req.query.attendanceStatus),
        workStatus: qs(req.query.workStatus) as any,
        taskStatus: qs(req.query.taskStatus),
        sortBy: (qs(req.query.sortBy) as any) || 'lastActivity',
        sortOrder: (qs(req.query.sortOrder) as any) || 'desc',
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Detailed employee directory retrieved successfully', result);
});

// ─── 2. Individual Employee Profile Header ──────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/profile
export const getEmployeeProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const profile = await DetailedMonitoringService.getEmployeeProfile(companyId, employeeId);
    return sendSuccess(res, 'Employee detailed profile retrieved successfully', profile);
});

// ─── 3. Employee Overview Summary ───────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/overview
export const getEmployeeOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const overview = await DetailedMonitoringService.getEmployeeOverview(companyId, employeeId, {
        dateRange: qs(req.query.dateRange) as any,
        startDate: qs(req.query.startDate),
        endDate: qs(req.query.endDate),
    });

    return sendSuccess(res, 'Employee overview metrics retrieved successfully', overview);
});

// ─── 4. Attendance & Time Tracking History ──────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/attendance
export const getEmployeeAttendance = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const attendanceHistory = await DetailedMonitoringService.getEmployeeAttendanceHistory(companyId, employeeId, {
        startDate: qs(req.query.startDate),
        endDate: qs(req.query.endDate),
        month: qs(req.query.month),
        year: qs(req.query.year),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee attendance history retrieved successfully', attendanceHistory);
});

// ─── 5. Assigned Projects ───────────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/projects
export const getEmployeeProjects = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const projects = await DetailedMonitoringService.getEmployeeProjects(companyId, employeeId, {
        status: qs(req.query.status) as any,
        search: qs(req.query.search),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee assigned projects retrieved successfully', projects);
});

// ─── 6. Assigned Tasks & History ────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/tasks
export const getEmployeeTasks = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const tasks = await DetailedMonitoringService.getEmployeeTasks(companyId, employeeId, {
        status: qs(req.query.status),
        priority: qs(req.query.priority),
        projectId: qs(req.query.projectId),
        sprintId: qs(req.query.sprintId),
        isBlocked: req.query.isBlocked === 'true' ? true : req.query.isBlocked === 'false' ? false : undefined,
        isOverdue: req.query.isOverdue === 'true' ? true : req.query.isOverdue === 'false' ? false : undefined,
        startDate: qs(req.query.startDate),
        endDate: qs(req.query.endDate),
        search: qs(req.query.search),
        sortBy: qs(req.query.sortBy),
        sortOrder: qs(req.query.sortOrder) as any,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee assigned tasks retrieved successfully', tasks);
});

// ─── 7. Meeting Participation History ───────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/meetings
export const getEmployeeMeetings = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const meetings = await DetailedMonitoringService.getEmployeeMeetings(companyId, employeeId, {
        status: qs(req.query.status),
        from: qs(req.query.from),
        to: qs(req.query.to),
        search: qs(req.query.search),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee meeting history retrieved successfully', meetings);
});

// ─── 8. Complete Activity Timeline ──────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/timeline
export const getEmployeeTimeline = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const timeline = await DetailedMonitoringService.getEmployeeTimeline(companyId, employeeId, {
        eventType: qs(req.query.eventType),
        projectId: qs(req.query.projectId),
        taskId: qs(req.query.taskId),
        from: qs(req.query.from),
        to: qs(req.query.to),
        cursor: qs(req.query.cursor),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee timeline retrieved successfully', timeline);
});

// ─── 9. Workload and Productivity Analytics ─────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/analytics
export const getEmployeeAnalytics = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const analytics = await DetailedMonitoringService.getEmployeeAnalytics(companyId, employeeId, {
        dateRange: qs(req.query.dateRange) as any,
        startDate: qs(req.query.startDate),
        endDate: qs(req.query.endDate),
    });

    return sendSuccess(res, 'Employee workload and productivity analytics retrieved successfully', analytics);
});

// ─── 10. Employee-Specific Alerts ───────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/alerts
export const getEmployeeAlerts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const alerts = await DetailedMonitoringService.getEmployeeAlerts(companyId, employeeId, {
        status: qs(req.query.status),
        severity: qs(req.query.severity),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, 'Employee alerts retrieved successfully', alerts);
});

// ─── 11. Acknowledge Alert ──────────────────────────────────────────────────
// PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/acknowledge
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

// ─── 12. Resolve Alert ──────────────────────────────────────────────────────
// PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/resolve
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

// ─── 13. Historical Report Export ───────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/export
export const exportEmployeeReport = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const employeeId = (req.params as Record<string, string>)['employeeId'] ?? '';
    if (!employeeId) {
        throw AppError.unprocessable('employeeId is required');
    }

    const reportType = (qs(req.query.type) as any) || 'WORKLOAD_SUMMARY';
    const report = await DetailedMonitoringService.exportEmployeeReport(companyId, employeeId, {
        type: reportType,
        format: (qs(req.query.format) as any) || 'csv',
        startDate: qs(req.query.startDate),
        endDate: qs(req.query.endDate),
    });

    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    return res.status(200).send(report.content);
});
