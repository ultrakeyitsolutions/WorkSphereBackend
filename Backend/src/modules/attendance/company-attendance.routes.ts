import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { requireFeature } from '../../middleware/entitlement.middleware';
import {
    lateArrivalsQuerySchema,
    companyAttendanceRecordsQuerySchema,
} from './attendance.validator';

const router = Router();

// Authentication and Company Admin authorization guard
router.use(authenticate);
router.use(authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'));

/**
 * @route   GET /api/v1/company/attendance/summary
 * @desc    Company attendance summary or employee monthly summary based on query params
 */
router.get('/summary', (req, res, next) => {
    if (req.query.month || req.query.year) {
        return AttendanceController.getSummary(req as any, res, next);
    }
    return AttendanceController.getCompanyAttendanceSummary(req as any, res, next);
});

/**
 * @route   GET /api/v1/company/attendance/late-arrivals
 * @desc    Top late arrivals ranking by late minutes with deterministic tie-breaking
 */
router.get(
    '/late-arrivals',
    requireFeature('BASIC_ANALYTICS'),
    validateRequest(lateArrivalsQuerySchema),
    AttendanceController.getCompanyLateArrivals
);

/**
 * @route   GET /api/v1/company/attendance/records
 * @desc    Paginated company attendance records with filters (status, late-only, incomplete)
 */
router.get(
    '/records',
    validateRequest(companyAttendanceRecordsQuerySchema),
    AttendanceController.getCompanyAttendanceRecords
);

/**
 * @route   GET /api/v1/company/attendance/admin
 * @desc    Admin daily workforce attendance list with shift, status, and punches
 */
router.get('/admin', AttendanceController.getAdminAttendanceList);

/**
 * @route   GET /api/v1/company/attendance/calendar
 * @desc    Calendar view & breakdown for the company / employee
 */
router.get('/calendar', AttendanceController.getCalendar);

/**
 * @route   GET /api/v1/company/attendance/admin/employees/:employeeId/calendar
 * @desc    Admin view of specific employee attendance calendar
 */
router.get('/admin/employees/:employeeId/calendar', AttendanceController.getAdminEmployeeCalendar);

/**
 * @route   POST /api/v1/company/attendance/admin/finalize
 * @desc    Finalize unpunched workforce attendance for a date
 */
router.post('/admin/finalize', AttendanceController.finalizeDailyAttendance);

/**
 * ── Adjustments Endpoints ──
 */
router.post('/adjustments', AttendanceController.requestAdjustment);
router.get('/adjustments', AttendanceController.getAdjustments);
router.patch('/admin/adjustments/:id/approve', AttendanceController.approveAdjustment);
router.patch('/admin/adjustments/:id/reject', AttendanceController.rejectAdjustment);

/**
 * ── Leaves Endpoints ──
 */
router.post('/leaves', AttendanceController.applyLeave);
router.get('/leaves', AttendanceController.getLeaves);
router.get('/leaves/preview', AttendanceController.previewLeave);
router.patch('/leaves/:id/cancel', AttendanceController.cancelLeave);
router.patch('/admin/leaves/:id/approve', AttendanceController.approveLeave);
router.patch('/admin/leaves/:id/approve-breakdown', AttendanceController.approveLeaveWithBreakdown);
router.patch('/admin/leaves/:id/reject', AttendanceController.rejectLeave);
router.post('/admin/leaves/:id/request-revision', AttendanceController.requestRevision);

/**
 * ── Holidays Endpoints ──
 */
router.post('/holidays', AttendanceController.createHoliday);
router.get('/holidays', AttendanceController.getHolidays);
router.put('/holidays/:id', AttendanceController.updateHoliday);
router.delete('/holidays/:id', AttendanceController.deleteHoliday);

/**
 * ── Reports Endpoints ──
 */
router.get('/reports/daily', AttendanceController.getDailyReport);
router.get('/reports/weekly', AttendanceController.getWeeklyReport);
router.get('/reports/monthly', AttendanceController.getMonthlyReport);
router.get('/reports/employee/:employeeId', AttendanceController.getEmployeeReport);

/**
 * @route   GET /api/v1/company/attendance/:attendanceId
 * @desc    Authorized attendance record detail (MUST be after all named routes)
 */
router.get('/:attendanceId', AttendanceController.getCompanyAttendanceRecordById);

export default router;
