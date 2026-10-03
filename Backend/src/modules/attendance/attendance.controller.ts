import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { AttendanceService } from './attendance.service';
import { AttendanceAdjustmentService } from './attendance-adjustment.service';
import { LeaveService } from './leave.service';
import { HolidayService } from './holiday.service';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceEventType } from './attendance.types';

export class AttendanceController {
    // ── Employee Punch Endpoints ─────────────────────────────────────────────

    static checkIn = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
        const result = await AttendanceService.checkIn(companyId, userId, req.body, {
            ip: typeof ip === 'string' ? ip.split(',')[0].trim() : undefined,
            deviceId: req.body.deviceId,
            source: req.body.source || 'WEB',
        });

        sendSuccess(res, 'Checked in successfully.', result, 200);
    });

    static checkOut = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
        const result = await AttendanceService.checkOut(companyId, userId, req.body, {
            ip: typeof ip === 'string' ? ip.split(',')[0].trim() : undefined,
            deviceId: req.body.deviceId,
            source: req.body.source || 'WEB',
        });

        sendSuccess(res, 'Checked out successfully.', result, 200);
    });

    static breakStart = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const result = await AttendanceService.recordBreak(
            companyId,
            userId,
            AttendanceEventType.BREAK_START,
            req.body
        );
        sendSuccess(res, 'Break started.', result, 200);
    });

    static breakEnd = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const result = await AttendanceService.recordBreak(
            companyId,
            userId,
            AttendanceEventType.BREAK_END,
            req.body
        );
        sendSuccess(res, 'Break ended.', result, 200);
    });

    static getCurrentStatus = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const status = await AttendanceService.getCurrentStatus(companyId, userId);
        sendSuccess(res, 'Current attendance status retrieved.', status, 200);
    });

    // ── Employee Calendar & Summary ──────────────────────────────────────────

    static getCalendar = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const calendar = await AttendanceService.getEmployeeCalendar(companyId, userId, req.query);
        sendSuccess(res, 'Attendance calendar retrieved.', calendar, 200);
    });

    static getSummary = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const summary = await AttendanceService.getEmployeeSummary(companyId, userId, req.query);
        sendSuccess(res, 'Attendance summary retrieved.', summary, 200);
    });

    // ── Adjustments ──────────────────────────────────────────────────────────

    static requestAdjustment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const adjustment = await AttendanceAdjustmentService.requestAdjustment(companyId, userId, req.body);
        sendSuccess(res, 'Attendance adjustment requested.', { adjustment }, 201);
    });

    static getAdjustments = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const role = req.user?.role;
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN';

        const result = await AttendanceAdjustmentService.getAdjustments(companyId, {
            ...req.query,
            employeeId: isAdmin && req.query.employeeId ? String(req.query.employeeId) : (!isAdmin ? userId : undefined),
        });

        sendSuccess(res, 'Attendance adjustments retrieved.', result, 200);
    });

    static approveAdjustment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const result = await AttendanceAdjustmentService.approveAdjustment(
            companyId,
            String(req.params.id),
            userId
        );
        sendSuccess(res, 'Attendance adjustment approved.', result, 200);
    });

    static rejectAdjustment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const adjustment = await AttendanceAdjustmentService.rejectAdjustment(
            companyId,
            String(req.params.id),
            userId,
            req.body.reason
        );
        sendSuccess(res, 'Attendance adjustment rejected.', { adjustment }, 200);
    });

    // ── Leave Requests ───────────────────────────────────────────────────────

    static applyLeave = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const leave = await LeaveService.applyLeave(companyId, userId, req.body);
        sendSuccess(res, 'Leave request submitted successfully.', { leave }, 201);
    });

    static getLeaves = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const role = req.user?.role;
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN';

        const result = await LeaveService.getLeaves(companyId, {
            ...req.query,
            employeeId: isAdmin && req.query.employeeId ? String(req.query.employeeId) : (!isAdmin ? userId : undefined),
        });

        sendSuccess(res, 'Leaves retrieved.', result, 200);
    });

    static approveLeave = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const leave = await LeaveService.approveLeave(companyId, String(req.params.id), userId);
        sendSuccess(res, 'Leave request approved and attendance synchronized.', { leave }, 200);
    });

    static rejectLeave = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const leave = await LeaveService.rejectLeave(companyId, String(req.params.id), userId, req.body.reason);
        sendSuccess(res, 'Leave request rejected.', { leave }, 200);
    });

    // ── Company Admin Dashboard & Calendar ────────────────────────────────────

    static getAdminAttendanceList = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const result = await AttendanceService.getAdminAttendanceList(companyId, req.query);
        sendSuccess(res, 'Admin attendance list retrieved.', result, 200);
    });

    static getAdminEmployeeCalendar = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const employeeId = String(req.params.employeeId);
        const calendar = await AttendanceService.getEmployeeCalendar(companyId, employeeId, req.query);
        sendSuccess(res, 'Employee attendance calendar retrieved.', calendar, 200);
    });

    static finalizeDailyAttendance = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const result = await AttendanceService.finalizeDailyAttendance(companyId, req.body?.date ? String(req.body.date) : undefined);
        sendSuccess(res, 'Daily attendance finalized successfully.', result, 200);
    });

    // ── Holidays ─────────────────────────────────────────────────────────────

    static createHoliday = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const holiday = await HolidayService.createHoliday(companyId, userId, req.body);
        sendSuccess(res, 'Holiday created successfully.', { holiday }, 201);
    });

    static getHolidays = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const holidays = await HolidayService.getHolidays(companyId, req.query);
        sendSuccess(res, 'Holidays retrieved.', { holidays }, 200);
    });

    static updateHoliday = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const holiday = await HolidayService.updateHoliday(companyId, String(req.params.id), userId, req.body);
        sendSuccess(res, 'Holiday updated successfully.', { holiday }, 200);
    });

    static deleteHoliday = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const result = await HolidayService.deleteHoliday(companyId, String(req.params.id), userId);
        sendSuccess(res, 'Holiday deleted successfully.', result, 200);
    });

    // ── Reports ──────────────────────────────────────────────────────────────

    static getDailyReport = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
        const report = await AttendanceReportService.getDailyReport(companyId, date);
        sendSuccess(res, 'Daily attendance report generated.', report, 200);
    });

    static getWeeklyReport = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const startDate = String(req.query.startDate);
        const endDate = String(req.query.endDate);
        if (!startDate || !endDate) throw AppError.badRequest('startDate and endDate are required.');

        const report = await AttendanceReportService.getWeeklyReport(companyId, startDate, endDate);
        sendSuccess(res, 'Weekly attendance report generated.', report, 200);
    });

    static getMonthlyReport = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const year = req.query.year ? String(req.query.year) : new Date().getFullYear();
        const month = req.query.month ? String(req.query.month) : new Date().getMonth() + 1;

        const report = await AttendanceReportService.getMonthlyReport(companyId, year, month);
        sendSuccess(res, 'Monthly attendance report generated.', report, 200);
    });

    static getEmployeeReport = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Unauthorized');

        const employeeId = String(req.params.employeeId);
        const startDate = String(req.query.startDate);
        const endDate = String(req.query.endDate);
        if (!startDate || !endDate) throw AppError.badRequest('startDate and endDate are required.');

        const report = await AttendanceReportService.getEmployeeReport(companyId, employeeId, startDate, endDate);
        sendSuccess(res, 'Employee attendance report generated.', report, 200);
    });
}
