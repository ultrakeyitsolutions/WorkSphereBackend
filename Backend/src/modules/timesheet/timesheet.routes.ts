import { Router } from 'express';
import { TimesheetController } from './timesheet.controller';

const router = Router();

// ─── Read endpoints ───────────────────────────────────────────────────────────

// GET /api/v1/company/timesheets
// Member: own data only. Admin: all company data with optional filters.
router.get('/', TimesheetController.getTimesheetData);

// GET /api/v1/company/timesheets/trend
// Daily productivity metrics array for a user across a date range.
router.get('/trend', TimesheetController.getProductivityTrend);

// GET /api/v1/company/timesheets/comparison
// Compare two periods side-by-side for a user.
router.get('/comparison', TimesheetController.comparePeriods);

// GET /api/v1/company/timesheets/project-distribution
// Hours per project for a user in a date range.
router.get('/project-distribution', TimesheetController.getProjectDistribution);

// GET /api/v1/company/timesheets/anomalies
// List of anomaly events for a user in a date range.
router.get('/anomalies', TimesheetController.getAnomalies);

// GET /api/v1/company/timesheets/timeline/:date
// Member:  JWT userId → own timeline.
// Admin:   ?employeeId=... to view another employee's timeline.
router.get('/timeline/:date', TimesheetController.getTimeline);

// ─── Approval workflow ────────────────────────────────────────────────────────

// POST /api/v1/company/timesheets/submit
// Member submits their timesheet for a period.
router.post('/submit', TimesheetController.submitTimesheet);

// POST /api/v1/company/timesheets/:id/approve  (Admin only)
router.post('/:id/approve', TimesheetController.approveTimesheet);

// POST /api/v1/company/timesheets/:id/reject   (Admin only)
router.post('/:id/reject', TimesheetController.rejectTimesheet);

// POST /api/v1/company/timesheets/:id/lock     (Admin only)
router.post('/:id/lock', TimesheetController.lockTimesheet);

// ─── Corrections ──────────────────────────────────────────────────────────────

// POST /api/v1/company/timesheets/correction   (Admin only)
router.post('/correction', TimesheetController.createCorrection);

export default router;
