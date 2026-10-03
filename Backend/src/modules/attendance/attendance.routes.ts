import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// Require authentication for all attendance routes
router.use(authenticate);

// ─── Employee Punch Endpoints ────────────────────────────────────────────────
router.post('/check-in', AttendanceController.checkIn);
router.post('/check-out', AttendanceController.checkOut);
router.post('/break/start', AttendanceController.breakStart);
router.post('/break/end', AttendanceController.breakEnd);
router.get('/status', AttendanceController.getCurrentStatus);

// ─── Employee Calendar & Summary ─────────────────────────────────────────────
router.get('/calendar', AttendanceController.getCalendar);
router.get('/summary', AttendanceController.getSummary);

// ─── Adjustments Endpoints ───────────────────────────────────────────────────
router.post('/adjustments', AttendanceController.requestAdjustment);
router.get('/adjustments', AttendanceController.getAdjustments);

// ─── Leaves Endpoints ────────────────────────────────────────────────────────
router.post('/leaves', AttendanceController.applyLeave);
router.get('/leaves', AttendanceController.getLeaves);

// ─── Admin Attendance Endpoints ──────────────────────────────────────────────
router.get('/admin', AttendanceController.getAdminAttendanceList);
router.get('/admin/employees/:employeeId/calendar', AttendanceController.getAdminEmployeeCalendar);
router.post('/admin/finalize', AttendanceController.finalizeDailyAttendance);
router.patch('/admin/adjustments/:id/approve', AttendanceController.approveAdjustment);
router.patch('/admin/adjustments/:id/reject', AttendanceController.rejectAdjustment);
router.patch('/admin/leaves/:id/approve', AttendanceController.approveLeave);
router.patch('/admin/leaves/:id/reject', AttendanceController.rejectLeave);

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

export default router;
