import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCompanyFeature } from '../../middleware/feature-toggle.middleware';

const router = Router();

// Require authentication for all attendance routes
router.use(authenticate);

// ─── Employee Punch Endpoints ────────────────────────────────────────────────
router.post('/check-in', AttendanceController.checkIn);
router.post('/check-out', AttendanceController.checkOut);
router.post('/break/start', AttendanceController.breakStart);
router.post('/break/end', AttendanceController.breakEnd);
router.get('/status', AttendanceController.getCurrentStatus);

// ─── Phase 6: Member Attendance Endpoints ────────────────────────────────────
router.get('/today', AttendanceController.getMemberTodayAttendance);
router.get('/history', AttendanceController.getMemberAttendanceHistory);

// ─── Phase 5: Company Admin Analytics Endpoints ──────────────────────────────
router.get('/records', AttendanceController.getCompanyAttendanceRecords);
router.get('/late-arrivals', AttendanceController.getCompanyLateArrivals);
router.get('/company-summary', AttendanceController.getCompanyAttendanceSummary);

// ─── Employee Calendar & Summary ─────────────────────────────────────────────
router.get('/calendar', AttendanceController.getCalendar);
router.get('/summary', (req, res, next) => {
    const role = (req as any).user?.role;
    const isAdmin = role === 'COMPANY_ADMIN' || role === 'Admin' || role === 'SUPER_ADMIN';
    if (isAdmin && (req.baseUrl.includes('company') || req.baseUrl.includes('admin') || (!req.query.employeeId && (req.query.date || req.query.startDate)))) {
        return AttendanceController.getCompanyAttendanceSummary(req as any, res, next);
    }
    return AttendanceController.getSummary(req as any, res, next);
});

// ─── Adjustments Endpoints ───────────────────────────────────────────────────
router.post('/adjustments', requireCompanyFeature('enableAttendanceAdjustments'), AttendanceController.requestAdjustment);
router.get('/adjustments', AttendanceController.getAdjustments);

// ─── Leaves Endpoints ────────────────────────────────────────────────────────
router.post('/leaves', AttendanceController.applyLeave);
router.get('/leaves', AttendanceController.getLeaves);
router.get('/leaves/preview', AttendanceController.previewLeave);
router.patch('/leaves/:id/cancel', AttendanceController.cancelLeave);

// ─── Admin Attendance Endpoints ──────────────────────────────────────────────
router.get('/admin', AttendanceController.getAdminAttendanceList);
router.get('/admin/employees/:employeeId/calendar', AttendanceController.getAdminEmployeeCalendar);
router.post('/admin/finalize', AttendanceController.finalizeDailyAttendance);
router.patch('/admin/adjustments/:id/approve', AttendanceController.approveAdjustment);
router.patch('/admin/adjustments/:id/reject', AttendanceController.rejectAdjustment);
router.patch('/admin/leaves/:id/approve', AttendanceController.approveLeave);
router.patch('/admin/leaves/:id/approve-breakdown', AttendanceController.approveLeaveWithBreakdown);
router.patch('/admin/leaves/:id/reject', AttendanceController.rejectLeave);
router.post('/admin/leaves/:id/request-revision', AttendanceController.requestRevision);

// ─── Holidays Endpoints ──────────────────────────────────────────────────────
router.post('/holidays', AttendanceController.createHoliday);
router.get('/holidays', AttendanceController.getHolidays);
router.put('/holidays/:id', AttendanceController.updateHoliday);
router.delete('/holidays/:id', AttendanceController.deleteHoliday);

// ─── Reports Endpoints ───────────────────────────────────────────────────────
router.get('/reports/daily', AttendanceController.getDailyReport);
router.get('/reports/weekly', AttendanceController.getWeeklyReport);
router.get('/reports/monthly', AttendanceController.getMonthlyReport);
router.get('/reports/employee/:employeeId', AttendanceController.getEmployeeReport);

// ─── Single Attendance Record Lookup (Role-Aware) ────────────────────────────
router.get('/:attendanceId', (req, res, next) => {
    const role = (req as any).user?.role;
    const isAdmin = role === 'COMPANY_ADMIN' || role === 'Admin' || role === 'SUPER_ADMIN';
    if (isAdmin && !req.baseUrl.includes('member')) {
        return AttendanceController.getCompanyAttendanceRecordById(req as any, res, next);
    }
    return AttendanceController.getMemberAttendanceRecordById(req as any, res, next);
});

export default router;
