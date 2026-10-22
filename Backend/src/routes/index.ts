import { Router, Request, Response } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import superAdminRoutes from '../modules/super-admin/super-admin.routes';
import companyAdminRoutes from '../modules/companyadmin/company-admin.routes';
import publicInvitationRoutes from '../modules/companyadmin/invitations/public-invitation.routes';
import dashboardRoutes from '../modules/dashboard/dashboard.routes';
import permissionRoutes from '../modules/permissions/permission.routes';
import projectMemberRoutes from '../modules/companyadmin/projects/project-member.routes';
import chatRoutes from '../modules/chat/chat.routes';
import messageRoutes from '../modules/chat/message.routes';
import fileRoutes from '../modules/files/file.routes';
import callRoutes from '../modules/calls/call.routes';
import notificationRoutes from '../modules/notifications/notification.routes';
import notificationPreferenceRoutes from '../modules/notifications/notification-preference.routes';
import { env } from '../config/env';

const router = Router();

// Health endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: 'WorkSphere API is running',
        environment: env.NODE_ENV,
    });
});

// ── Public Modules ────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);

// ── Public Account Recovery Routes (no auth) ──────────────────────────────────
// POST /api/v1/public/account-recovery-requests
// GET  /api/v1/public/account-recovery-requests/:requestId/status
// POST /api/v1/public/account-recovery-requests/:requestId/complete
import {
    publicAccountRecoveryRouter,
    superAdminAccountRecoveryRouter,
} from '../modules/auth/recovery/account-recovery.routes';

router.use('/v1/public', publicAccountRecoveryRouter);
router.use('/public', publicAccountRecoveryRouter);

// ── Super Admin Account Recovery Routes (SUPER_ADMIN auth required) ───────────
// GET  /api/v1/superadmin/account-recovery-requests
// GET  /api/v1/superadmin/account-recovery-requests/:requestId
// POST /api/v1/superadmin/account-recovery-requests/:requestId/approve
// POST /api/v1/superadmin/account-recovery-requests/:requestId/reject
router.use('/v1/superadmin', superAdminAccountRecoveryRouter);
router.use('/v1/super-admin', superAdminAccountRecoveryRouter);
router.use('/superadmin', superAdminAccountRecoveryRouter);
router.use('/super-admin', superAdminAccountRecoveryRouter);

// ── Public Invitation Routes (no auth) ────────────────────────────────────────
// GET  /api/v1/invitations/validate?token=xxx
// POST /api/v1/invitations/accept
// POST /api/v1/invitations/register
router.use('/v1/invitations', publicInvitationRoutes);

// ── Permissions Route (auth required) ─────────────────────────────────────────
router.use('/v1/permissions', permissionRoutes);

// ── Unified Role-Aware Dashboard Routes (auth required) ───────────────────────
router.use('/dashboard', dashboardRoutes);
router.use('/v1/dashboard', dashboardRoutes);

// ── Company Admin Redesigned Dashboard Analytics Routes ───────────────────────
import companyDashboardRoutes from '../modules/dashboard/routes/company-dashboard.routes';
import memberDashboardRoutes from '../modules/dashboard/routes/member-dashboard.routes';

router.use('/v1/company/dashboard', companyDashboardRoutes);
router.use('/v1/company-admin/dashboard', companyDashboardRoutes);
router.use('/company/dashboard', companyDashboardRoutes);
router.use('/company-admin/dashboard', companyDashboardRoutes);

// ── Member Redesigned Dashboard Analytics Routes ──────────────────────────────
router.use('/v1/member/dashboard', memberDashboardRoutes);
router.use('/v1/members/dashboard', memberDashboardRoutes);
router.use('/member/dashboard', memberDashboardRoutes);

// ── Company Admin Attendance Analytics Routes ────────────────────────────────
import companyAttendanceRoutes from '../modules/attendance/company-attendance.routes';
import memberAttendanceRoutes from '../modules/attendance/member-attendance.routes';

router.use('/v1/company/attendance', companyAttendanceRoutes);
router.use('/v1/company-admin/attendance', companyAttendanceRoutes);
router.use('/company/attendance', companyAttendanceRoutes);
router.use('/company-admin/attendance', companyAttendanceRoutes);

// ── Member Attendance Routes ──────────────────────────────────────────────────
router.use('/v1/member/attendance', memberAttendanceRoutes);
router.use('/v1/members/attendance', memberAttendanceRoutes);
router.use('/member/attendance', memberAttendanceRoutes);

// ── Company & Member Routes (auth required) ──────────────────────────────────
router.use('/company', companyAdminRoutes);
router.use('/company-admin', companyAdminRoutes);
router.use('/v1/company', companyAdminRoutes);
router.use('/v1/company-admin', companyAdminRoutes);
router.use('/v1/member', companyAdminRoutes);
router.use('/v1/members', companyAdminRoutes);


// ── Communication & Global Media Modules ──────────────────────────────────────
router.use('/projects', projectMemberRoutes);
router.use('/conversations', chatRoutes);
router.use('/messages', messageRoutes);
router.use('/files', fileRoutes);
router.use('/calls', callRoutes);
router.use('/notifications', notificationRoutes);

import meetingRoutes from '../modules/meetings/meeting.routes';
import stickyNoteRoutes from '../modules/sticky-notes/sticky-note.routes';

// ── Meetings Module ───────────────────────────────────────────────────────────
router.use('/meetings', meetingRoutes);
router.use('/v1/meetings', meetingRoutes);

// ── Sticky Notes Module ───────────────────────────────────────────────────────
router.use('/sticky-notes', stickyNoteRoutes);
router.use('/v1/sticky-notes', stickyNoteRoutes);

// Also alias under /v1 for flexibility
router.use('/v1/projects', projectMemberRoutes);
router.use('/v1/conversations', chatRoutes);
router.use('/v1/messages', messageRoutes);
router.use('/v1/files', fileRoutes);
router.use('/v1/calls', callRoutes);
router.use('/v1/notifications', notificationRoutes);
router.use('/v1/company/notification-preferences', notificationPreferenceRoutes);

import attendanceRoutes from '../modules/attendance/attendance.routes';

// ── Attendance Module (auth required) ─────────────────────────────────────────
router.use('/attendance', attendanceRoutes);
router.use('/v1/attendance', attendanceRoutes);
router.use('/admin/attendance', attendanceRoutes);
router.use('/v1/admin/attendance', attendanceRoutes);

import impersonationRoutes from '../modules/super-admin/impersonation/impersonation.routes';

// ── Super Admin Impersonation Routes ──────────────────────────────────────────
// POST /api/superadmin/impersonation/start
// POST /api/superadmin/impersonation/stop
// GET  /api/superadmin/impersonation/current
router.use('/superadmin/impersonation', impersonationRoutes);
router.use('/super-admin/impersonation', impersonationRoutes);
router.use('/v1/superadmin/impersonation', impersonationRoutes);
router.use('/v1/super-admin/impersonation', impersonationRoutes);

import superAdminDashboardRoutes from '../modules/super-admin';

// ── Super Admin Dashboard & Modular Routes ────────────────────────────────────
router.use('/superadmin', superAdminDashboardRoutes);
router.use('/super-admin', superAdminDashboardRoutes);
router.use('/v1/superadmin', superAdminDashboardRoutes);
router.use('/v1/super-admin', superAdminDashboardRoutes);

// ── Global Search Routes (auth required, role-aware) ─────────────────────────
import globalSearchRoutes from '../modules/super-admin/global-search/global-search.routes';
router.use('/global-search', globalSearchRoutes);
router.use('/v1/global-search', globalSearchRoutes);

// ── Payment & Subscription Billing Routes ──────────────────────────────────
import { paymentRoutes } from '../modules/payments';
router.use('/v1/payments', paymentRoutes);
router.use('/payments', paymentRoutes);

// ── Legacy / Plan / Storage Super Admin Routes ────────────────────────────────
router.use('/super-admin', superAdminRoutes);

export default router;

