import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import {
    companyAttendanceSummaryQuerySchema,
    lateArrivalsQuerySchema,
    companyAttendanceRecordsQuerySchema,
} from './attendance.validator';

const router = Router();

// Authentication and Company Admin authorization guard
router.use(authenticate);
router.use(authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'));

/**
 * @route   GET /api/v1/company/attendance/summary
 * @desc    Company attendance summary metrics for a date or bounded date range
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/summary',
    validateRequest(companyAttendanceSummaryQuerySchema),
    AttendanceController.getCompanyAttendanceSummary
);

import { requireFeature } from '../../middleware/entitlement.middleware';

/**
 * @route   GET /api/v1/company/attendance/late-arrivals
 * @desc    Top late arrivals ranking by late minutes with deterministic tie-breaking
 * @access  Private (Company Admin, Admin, Super Admin)
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
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/records',
    validateRequest(companyAttendanceRecordsQuerySchema),
    AttendanceController.getCompanyAttendanceRecords
);

/**
 * @route   GET /api/v1/company/attendance/:attendanceId
 * @desc    Authorized attendance record detail with shift info, calculations, and adjustments
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get('/:attendanceId', AttendanceController.getCompanyAttendanceRecordById);

export default router;
