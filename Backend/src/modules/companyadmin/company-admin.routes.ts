import { requireModuleAccess } from '../../middleware/module-access.middleware';
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import companyRoleRoutes from './invitations/roles/company-role.routes';
import designationRoutes from './invitations/designation/designation.routes';
import invitationRoutes from './invitations/invitation.routes';
import employeeRoutes from './members/employee.routes';
import managerAdminRoutes from '../manager/routes/manager-admin.routes';
import teamRoutes from '../teams/team.routes';
import clientRoutes from './members/client.routes';
import memberRoutes from './members/member.routes';
import projectRoutes from './projects/project.routes';
import taskRoutes from '../tasks/task.routes';
import taskMetaRoutes from '../tasks/task-meta.routes';
import taskActivityRootRoutes from '../task-activities/task-activity.root.routes';
import taskBugRootRoutes from '../task-bugs/task-bug.root.routes';
import taskAttachmentRootRoutes from '../task-attachments/task-attachment.root.routes';
import permissionsRoutes from './permissions.routes';
import companyProfileRoutes from './profile/company-profile.routes';
import companySettingsRoutes from './settings/company-settings.routes';
import impersonationRoutes from '../super-admin/impersonation/impersonation.routes';
import moduleAccessRoutes from './module-access/module-access.routes';
import leaveAdminRoutes from './leave/leave-admin.routes';
import memberDashboardRoutes from './members/member-dashboard.routes';
import performanceRoutes from '../performance/performance.routes';
import companyBillingRoutes from './billing/company-billing.routes';

const router = Router();

// ─── Rate limiting for invitation endpoints (per authenticated admin) ─────────
const inviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,
    keyGenerator: (req) => (req as any).user?.userId || ipKeyGenerator(req.ip || '127.0.0.1'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many invitation requests, please try again later.' },
});


// ─── Authentication guard for ALL company-admin routes ───────────────────────
// Note: companyId is read from the JWT payload (set during token generation).
// The frontend must NEVER supply companyId directly for these routes.
router.use(authenticate);

// ── /api/v1/company/billing ───────────────────────────────────────────────────
router.use('/billing', companyBillingRoutes);

// ── /api/v1/company/impersonation ─────────────────────────────────────────────
router.use('/impersonation', impersonationRoutes);

// ── /api/v1/company/settings ─────────────────────────────────────────────────
router.use('/settings', companySettingsRoutes);

// ── /api/v1/company/leave & /api/v1/company/leaves ────────────────────────────
router.use('/leave', requireModuleAccess('leave'), leaveAdminRoutes);
router.use('/leaves', requireModuleAccess('leave'), leaveAdminRoutes);

// ── /api/v1/company/module-access & /api/v1/company/sidebar-access ───────────
router.use('/module-access', moduleAccessRoutes);
router.use('/sidebar-access', moduleAccessRoutes);

// ── /api/v1/company/profile ──────────────────────────────────────────────────
router.use('/profile', companyProfileRoutes);

// ── /api/v1/company/dashboard  (also accessible via /api/v1/member/dashboard) ──
router.use('/dashboard', memberDashboardRoutes);

// ── /api/v1/company/roles ────────────────────────────────────────────────────
router.use('/roles', companyRoleRoutes);

// ── /api/v1/company/designations ─────────────────────────────────────────────
router.use('/designations', designationRoutes);

// ── /api/v1/company/invitations ───────────────────────────────────────────────
router.use('/invitations', inviteLimiter, invitationRoutes);

// ── /api/v1/company/employees ────────────────────────────────────────────────
router.use('/employees', employeeRoutes);

// ── /api/v1/company/users/permissions & performance ─────────────────────────
import { searchAllUsers, changeUserRole } from './members/employee.controller';
router.get('/users/search-all', searchAllUsers);
router.post('/users/:userId/role', changeUserRole);
router.use('/users/permissions', permissionsRoutes);
router.use('/users', performanceRoutes);

// ── /api/v1/company/clients ──────────────────────────────────────────────────
router.use('/clients', clientRoutes);

// ── /api/v1/company/managers ─────────────────────────────────────────────────
router.use('/managers', managerAdminRoutes);
router.use('/teams', teamRoutes);

// ── /api/v1/company/members ──────────────────────────────────────────────────
router.use('/members', memberRoutes);

// ── /api/v1/company/projects ──────────────────────────────────────────────────
router.use('/projects', requireModuleAccess('projects'), projectRoutes);

// ── /api/v1/company/tasks ────────────────────────────────────────────────────
router.use('/tasks', requireModuleAccess('tasks'), taskRoutes);

// ── /api/v1/company/task-activities ──────────────────────────────────────────
router.use('/task-activities', requireModuleAccess('tasks'), taskActivityRootRoutes);

// ── /api/v1/company/task-bugs ────────────────────────────────────────────────
router.use('/task-bugs', requireModuleAccess('tasks'), taskBugRootRoutes);

// ── /api/v1/company/task-attachments ─────────────────────────────────────────
router.use('/task-attachments', requireModuleAccess('tasks'), taskAttachmentRootRoutes);

import taskTrackingRoutes from '../task-tracking/task-tracking.routes';
import taskIntelligenceRoutes from '../task-intelligence/task-intelligence.routes';
import attendanceRoutes from '../attendance/attendance.routes';
import timesheetRoutes from '../timesheet/timesheet.routes';

import taskExplanationRatingRoutes from '../task-explanation-rating/task-explanation-rating.routes';
import calendarRoutes from '../calendar/calendar.routes';

// ── /api/v1/company/calendar ─────────────────────────────────────────────────
router.use('/calendar', requireModuleAccess('calendar'), calendarRoutes);

// ── /api/v1/company/attendance ───────────────────────────────────────────────
router.use('/attendance', requireModuleAccess('attendance'), attendanceRoutes);

// ── /api/v1/company/task-tracking ────────────────────────────────────────────
router.use('/task-tracking', requireModuleAccess('tasks'), taskTrackingRoutes);

// ── /api/v1/company/task-intelligence ────────────────────────────────────────
router.use('/task-intelligence', requireModuleAccess('tasks'), taskIntelligenceRoutes);

// ── /api/v1/company/task-explanation-ratings ─────────────────────────────────
router.use('/task-explanation-ratings', requireModuleAccess('tasks'), taskExplanationRatingRoutes);

// ── /api/v1/company/timesheets ────────────────────────────────────────────────
router.use('/timesheets', requireModuleAccess('timesheet'), timesheetRoutes);

import { shiftRoutes, shiftAssignmentRoutes } from '../shifts';

// ── /api/v1/company/shifts ────────────────────────────────────────────────────
router.use('/shifts', requireModuleAccess('shifts'), shiftRoutes);

// ── /api/v1/company/shift-assignments ─────────────────────────────────────────
router.use('/shift-assignments', requireModuleAccess('shifts'), shiftAssignmentRoutes);

import liveMonitoringRoutes from './live-monitoring/live-monitoring.routes';
import detailedMonitoringRoutes from './detailed-monitoring/detailed-monitoring.routes';

// ── /api/v1/company/live-monitoring ──────────────────────────────────────────
router.use('/live-monitoring', liveMonitoringRoutes);

// ── /api/v1/company/detailed-monitoring ──────────────────────────────────────
router.use('/detailed-monitoring', detailedMonitoringRoutes);
router.use('/live-monitoring/detailed', detailedMonitoringRoutes);

// ── /api/v1/company/[modules|statuses|stages|task-templates] ─────────────────
router.use('/', taskMetaRoutes);

export default router;

