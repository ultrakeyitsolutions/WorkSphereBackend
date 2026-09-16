import { Router, Request, Response } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import superAdminRoutes from '../modules/super-admin/super-admin.routes';
import companyAdminRoutes from '../modules/companyadmin/company-admin.routes';
import publicInvitationRoutes from '../modules/companyadmin/invitations/public-invitation.routes';
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

// Also alias under /v1 for flexibility
router.use('/v1/projects', projectMemberRoutes);
router.use('/v1/conversations', chatRoutes);
router.use('/v1/messages', messageRoutes);
router.use('/v1/files', fileRoutes);
router.use('/v1/calls', callRoutes);
router.use('/v1/notifications', notificationRoutes);
router.use('/v1/company/notification-preferences', notificationPreferenceRoutes);

// ── Protected Modules ─────────────────────────────────────────────────────────
router.use('/super-admin', superAdminRoutes);

export default router;
