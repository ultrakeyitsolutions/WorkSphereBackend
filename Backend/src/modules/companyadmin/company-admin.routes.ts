import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import rateLimit from 'express-rate-limit';
import companyRoleRoutes from './invitations/roles/company-role.routes';
import designationRoutes from './invitations/designation/designation.routes';
import invitationRoutes from './invitations/invitation.routes';
import employeeRoutes from './members/employee.routes';
import managerRoutes from './members/manager.routes';
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
import memberDashboardRoutes from './members/member-dashboard.routes';
import performanceRoutes from '../performance/performance.routes';

const router = Router();

// ─── Rate limiting for invitation endpoints ────────────────────────────────────
const inviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many invitation requests, please try again later.' },
});

// ─── Authentication guard for ALL company-admin routes ───────────────────────
// Note: companyId is read from the JWT payload (set during token generation).
// The frontend must NEVER supply companyId directly for these routes.
router.use(authenticate);

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
router.use('/users/permissions', permissionsRoutes);
router.use('/users', performanceRoutes);

// ── /api/v1/company/clients ──────────────────────────────────────────────────
router.use('/clients', clientRoutes);

// ── /api/v1/company/managers ─────────────────────────────────────────────────
router.use('/managers', managerRoutes);

// ── /api/v1/company/members ──────────────────────────────────────────────────
router.use('/members', memberRoutes);

// ── /api/v1/company/projects ──────────────────────────────────────────────────
router.use('/projects', projectRoutes);

// ── /api/v1/company/tasks ────────────────────────────────────────────────────
router.use('/tasks', taskRoutes);

// ── /api/v1/company/task-activities ──────────────────────────────────────────
router.use('/task-activities', taskActivityRootRoutes);

// ── /api/v1/company/task-bugs ────────────────────────────────────────────────
router.use('/task-bugs', taskBugRootRoutes);

// ── /api/v1/company/task-attachments ─────────────────────────────────────────
router.use('/task-attachments', taskAttachmentRootRoutes);

import taskTrackingRoutes from '../task-tracking/task-tracking.routes';
import taskIntelligenceRoutes from '../task-intelligence/task-intelligence.routes';
import attendanceRoutes from '../attendance/attendance.routes';
import timesheetRoutes from '../timesheet/timesheet.routes';

import taskExplanationRatingRoutes from '../task-explanation-rating/task-explanation-rating.routes';
import calendarRoutes from '../calendar/calendar.routes';

// ── /api/v1/company/calendar ─────────────────────────────────────────────────
router.use('/calendar', calendarRoutes);

// ── /api/v1/company/attendance ───────────────────────────────────────────────
router.use('/attendance', attendanceRoutes);

// ── /api/v1/company/task-tracking ────────────────────────────────────────────
router.use('/task-tracking', taskTrackingRoutes);

// ── /api/v1/company/task-intelligence ────────────────────────────────────────
router.use('/task-intelligence', taskIntelligenceRoutes);

// ── /api/v1/company/task-explanation-ratings ─────────────────────────────────
router.use('/task-explanation-ratings', taskExplanationRatingRoutes);

// ── /api/v1/company/timesheets ────────────────────────────────────────────────
router.use('/timesheets', timesheetRoutes);

// ── /api/v1/company/[modules|statuses|stages|task-templates] ─────────────────
router.use('/', taskMetaRoutes);

export default router;
