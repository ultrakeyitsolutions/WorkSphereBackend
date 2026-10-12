import { Router } from 'express';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    getEmployeesDirectory,
    getEmployeeProfile,
    getEmployeeOverview,
    getEmployeeAttendance,
    getEmployeeProjects,
    getEmployeeTasks,
    getEmployeeMeetings,
    getEmployeeTimeline,
    getEmployeeAnalytics,
    getEmployeeAlerts,
    acknowledgeAlert,
    resolveAlert,
    exportEmployeeReport,
} from './detailed-monitoring.controller';
import {
    getDetailedEmployeesSchema,
    getEmployeeProfileSchema,
    getEmployeeOverviewSchema,
    getEmployeeAttendanceSchema,
    getEmployeeProjectsSchema,
    getEmployeeTasksSchema,
    getEmployeeMeetingsSchema,
    getEmployeeTimelineSchema,
    getEmployeeAnalyticsSchema,
    getEmployeeAlertsSchema,
    acknowledgeEmployeeAlertSchema,
    resolveEmployeeAlertSchema,
    exportEmployeeReportSchema,
} from './detailed-monitoring.validator';
import { requireCompanyFeature } from '../../../middleware/feature-toggle.middleware';
import { requireModuleAccess } from '../../../middleware/module-access.middleware';

const router = Router();

// Guard all detailed monitoring endpoints with company feature toggle, plan entitlement & member access
router.use(requireCompanyFeature('enableDetailedMonitoring'));
router.use(requireModuleAccess('detailed-monitoring'));

// ── 1. Searchable Employee Directory ──────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees
router.get('/employees', validateRequest(getDetailedEmployeesSchema), getEmployeesDirectory);

// ── 2. Individual Employee Profile Header ─────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/profile
router.get('/employees/:employeeId/profile', validateRequest(getEmployeeProfileSchema), getEmployeeProfile);

// ── 3. Employee Overview Summary Dashboard ────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/overview
router.get('/employees/:employeeId/overview', validateRequest(getEmployeeOverviewSchema), getEmployeeOverview);

// ── 4. Attendance & Time Tracking History ─────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/attendance
router.get('/employees/:employeeId/attendance', validateRequest(getEmployeeAttendanceSchema), getEmployeeAttendance);

// ── 5. Assigned Projects ──────────────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/projects
router.get('/employees/:employeeId/projects', validateRequest(getEmployeeProjectsSchema), getEmployeeProjects);

// ── 6. Assigned Tasks & Task History ──────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/tasks
router.get('/employees/:employeeId/tasks', validateRequest(getEmployeeTasksSchema), getEmployeeTasks);

// ── 7. Meeting Participation History ──────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/meetings
router.get('/employees/:employeeId/meetings', validateRequest(getEmployeeMeetingsSchema), getEmployeeMeetings);

// ── 8. Complete Activity Timeline ─────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/timeline
router.get('/employees/:employeeId/timeline', validateRequest(getEmployeeTimelineSchema), getEmployeeTimeline);

// ── 9. Workload and Productivity Analytics ────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/analytics
router.get('/employees/:employeeId/analytics', validateRequest(getEmployeeAnalyticsSchema), getEmployeeAnalytics);

// ── 10. Employee-Specific Alerts ──────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/alerts
router.get('/employees/:employeeId/alerts', validateRequest(getEmployeeAlertsSchema), getEmployeeAlerts);

// ── 11. Acknowledge Alert ─────────────────────────────────────────────────────
// PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/acknowledge
router.patch('/alerts/:alertId/acknowledge', validateRequest(acknowledgeEmployeeAlertSchema), acknowledgeAlert);

// ── 12. Resolve Alert ─────────────────────────────────────────────────────────
// PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/resolve
router.patch('/alerts/:alertId/resolve', validateRequest(resolveEmployeeAlertSchema), resolveAlert);

// ── 13. Historical Report Export ──────────────────────────────────────────────
// GET /api/v1/company/detailed-monitoring/employees/:employeeId/export
router.get('/employees/:employeeId/export', validateRequest(exportEmployeeReportSchema), exportEmployeeReport);

export default router;
