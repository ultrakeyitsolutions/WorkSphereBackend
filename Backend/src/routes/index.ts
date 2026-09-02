import { Router, Request, Response } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import superAdminRoutes from '../modules/super-admin/super-admin.routes';
import companyAdminRoutes from '../modules/companyadmin/company-admin.routes';
import publicInvitationRoutes from '../modules/companyadmin/invitations/public-invitation.routes';
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

// ── Company Admin Routes (auth required) ──────────────────────────────────────
// POST   /api/v1/company/roles
// GET    /api/v1/company/roles
// GET    /api/v1/company/roles/:roleId
// PUT    /api/v1/company/roles/:roleId
// PATCH  /api/v1/company/roles/:roleId/status
// DELETE /api/v1/company/roles/:roleId
// POST   /api/v1/company/designations
// GET    /api/v1/company/designations
// ...
// POST   /api/v1/company/invitations
// GET    /api/v1/company/invitations
router.use('/v1/company', companyAdminRoutes);

// ── Protected Modules ─────────────────────────────────────────────────────────
router.use('/super-admin', superAdminRoutes);

export default router;
