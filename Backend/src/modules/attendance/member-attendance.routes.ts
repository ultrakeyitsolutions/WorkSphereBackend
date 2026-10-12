import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { memberAttendanceHistoryQuerySchema } from './attendance.validator';

const router = Router();

// Authentication guard: Scoped strictly to authenticated member
router.use(authenticate);

/**
 * @route   GET /api/v1/member/attendance/today
 * @desc    Today's attendance state, active shift, scheduled vs actual punches, and metrics
 * @access  Private (Authenticated Member)
 */
router.get('/today', AttendanceController.getMemberTodayAttendance);

/**
 * @route   GET /api/v1/member/attendance/history
 * @desc    Member attendance history across bounded date range with pagination
 * @access  Private (Authenticated Member)
 */
router.get(
    '/history',
    validateRequest(memberAttendanceHistoryQuerySchema),
    AttendanceController.getMemberAttendanceHistory
);

/**
 * @route   GET /api/v1/member/attendance/:attendanceId
 * @desc    Member attendance day detail with cross-user ID tampering prevention
 * @access  Private (Authenticated Member)
 */
router.get('/:attendanceId', AttendanceController.getMemberAttendanceRecordById);

export default router;
