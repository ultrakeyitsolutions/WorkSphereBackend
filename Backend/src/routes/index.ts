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

// ── Company & Member Routes (auth required) ──────────────────────────────────
router.use('/company', companyAdminRoutes);
router.use('/v1/company', companyAdminRoutes);
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

// ── Legacy / Plan / Storage Super Admin Routes ────────────────────────────────
router.use('/super-admin', superAdminRoutes);

export default router;

