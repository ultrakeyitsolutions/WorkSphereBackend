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

// Authentication guard for all company attendance routes.
// Role-based authorization is applied per-route below so that employee
// self-service routes (check-in/out, status, today, history, adjustments,
// leaves) remain accessible while company-admin analytics routes stay
// restricted to COMPANY_ADMIN / Admin / SUPER_ADMIN.
router.use(authenticate);

const adminOnly = authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN');

/**
 * @route   GET /api/v1/company/attendance/summary
 * @desc    Company attendance summary or employee monthly summary based on query params
 */
router.get('/summary', (req, res, next) => {
    if (req.query.month || req.query.year) {
        return AttendanceController.getSummary(req as any, res, next);
    }
    return adminOnly(req as any, res, () => {
        return AttendanceController.getCompanyAttendanceSummary(req as any, res, next);
    });
});

/**
 * @route   GET /api/v1/company/attendance/late-arrivals
 * @desc    Top late arrivals ranking by late minutes with deterministic tie-breaking
 */
router.get(
    '/late-arrivals',
    adminOnly,
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
    adminOnly,
    validateRequest(companyAttendanceRecordsQuerySchema),
    AttendanceController.getCompanyAttendanceRecords
);

/**
 * @route   GET /api/v1/company/attendance/admin
 * @desc    Admin daily workforce attendance list with shift, status, and punches
 */
router.get('/admin', adminOnly, AttendanceController.getAdminAttendanceList);

/**
 * @route   GET /api/v1/company/attendance/calendar
 * @desc    Calendar view & breakdown for the company / employee
 */
router.get('/calendar', AttendanceController.getCalendar);

/**
 * @route   GET /api/v1/company/attendance/admin/employees/:employeeId/calendar
 * @desc    Admin view of specific employee attendance calendar
 */
router.get(
    '/admin/employees/:employeeId/calendar',
    adminOnly,
    AttendanceController.getAdminEmployeeCalendar
);

/**
 * @route   POST /api/v1/company/attendance/admin/finalize
 * @desc    Finalize unpunched workforce attendance for a date
 */
router.post('/admin/finalize', adminOnly, AttendanceController.finalizeDailyAttendance);

/**
 * ── Adjustments Endpoints ──
 */
router.post('/adjustments', AttendanceController.requestAdjustment);
router.get('/adjustments', AttendanceController.getAdjustments);
router.patch('/admin/adjustments/:id/approve', adminOnly, AttendanceController.approveAdjustment);
router.patch('/admin/adjustments/:id/reject', adminOnly, AttendanceController.rejectAdjustment);

/**
 * ── Leaves Endpoints ──
 */
router.post('/leaves', AttendanceController.applyLeave);
router.get('/leaves', AttendanceController.getLeaves);
router.get('/leaves/preview', AttendanceController.previewLeave);
router.patch('/leaves/:id/cancel', AttendanceController.cancelLeave);
router.patch('/admin/leaves/:id/approve', adminOnly, AttendanceController.approveLeave);
router.patch('/admin/leaves/:id/approve-breakdown', adminOnly, AttendanceController.approveLeaveWithBreakdown);
router.patch('/admin/leaves/:id/reject', adminOnly, AttendanceController.rejectLeave);
router.post('/admin/leaves/:id/request-revision', adminOnly, AttendanceController.requestRevision);

/**
 * ── Holidays Endpoints ──
 */
router.post('/holidays', adminOnly, AttendanceController.createHoliday);
router.get('/holidays', AttendanceController.getHolidays);
router.put('/holidays/:id', adminOnly, AttendanceController.updateHoliday);
router.delete('/holidays/:id', adminOnly, AttendanceController.deleteHoliday);

/**
 * ── Reports Endpoints ──
 */
router.get('/reports/daily', adminOnly, AttendanceController.getDailyReport);
router.get('/reports/weekly', adminOnly, AttendanceController.getWeeklyReport);
router.get('/reports/monthly', adminOnly, AttendanceController.getMonthlyReport);
router.get('/reports/employee/:employeeId', adminOnly, AttendanceController.getEmployeeReport);

/**
 * @route   GET /api/v1/company/attendance/:attendanceId
 * @desc    Authorized attendance record detail (MUST be after all named routes)
 */
router.get('/:attendanceId', AttendanceController.getCompanyAttendanceRecordById);

export default router;
