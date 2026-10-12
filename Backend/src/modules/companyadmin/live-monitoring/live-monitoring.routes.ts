import { Router } from 'express';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    getOverview,
    getEmployees,
    getEmployeeById,
    getActivityFeed,
    getProjects,
    getAttendanceSnapshot,
    getAlerts,
    acknowledgeAlert,
    resolveAlert,
    evaluateAlerts,
} from './live-monitoring.controller';
import {
    getLiveOverviewSchema,
    getLiveEmployeesSchema,
    getLiveEmployeeDetailSchema,
    getLiveActivitySchema,
    getLiveProjectsSchema,
    getLiveAttendanceSchema,
    getLiveAlertsSchema,
    acknowledgeAlertSchema,
    resolveAlertSchema,
} from './live-monitoring.validator';
import { requireCompanyFeature } from '../../../middleware/feature-toggle.middleware';
import { requireModuleAccess } from '../../../middleware/module-access.middleware';

const router = Router();

// Guard all live monitoring endpoints with company feature toggle, plan entitlement & member access
router.use(requireCompanyFeature('enableLiveMonitoring'));
router.use(requireModuleAccess('live-monitoring'));

// ── Dashboard Overview ────────────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/overview
router.get('/overview', validateRequest(getLiveOverviewSchema), getOverview);

// ── Employees Live Monitoring ────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/employees
router.get('/employees', validateRequest(getLiveEmployeesSchema), getEmployees);

// GET /api/v1/company/live-monitoring/employees/:employeeId
router.get('/employees/:employeeId', validateRequest(getLiveEmployeeDetailSchema), getEmployeeById);

// ── Real-Time Activity Feed ──────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/activity
router.get('/activity', validateRequest(getLiveActivitySchema), getActivityFeed);

// ── Live Projects Overview ───────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/projects
router.get('/projects', validateRequest(getLiveProjectsSchema), getProjects);

// ── Attendance Snapshot ──────────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/attendance
router.get('/attendance', validateRequest(getLiveAttendanceSchema), getAttendanceSnapshot);

// ── Live Actionable Alerts ───────────────────────────────────────────────────
// GET /api/v1/company/live-monitoring/alerts
router.get('/alerts', validateRequest(getLiveAlertsSchema), getAlerts);

// POST /api/v1/company/live-monitoring/alerts/evaluate (manual or scheduled trigger)
router.post('/alerts/evaluate', evaluateAlerts);

// PATCH /api/v1/company/live-monitoring/alerts/:alertId/acknowledge
router.patch('/alerts/:alertId/acknowledge', validateRequest(acknowledgeAlertSchema), acknowledgeAlert);

// PATCH /api/v1/company/live-monitoring/alerts/:alertId/resolve
router.patch('/alerts/:alertId/resolve', validateRequest(resolveAlertSchema), resolveAlert);

export default router;
