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

// ── /api/v1/company/roles ────────────────────────────────────────────────────
router.use('/roles', companyRoleRoutes);

// ── /api/v1/company/designations ─────────────────────────────────────────────
router.use('/designations', designationRoutes);

// ── /api/v1/company/invitations ───────────────────────────────────────────────
router.use('/invitations', inviteLimiter, invitationRoutes);

// ── /api/v1/company/employees ────────────────────────────────────────────────
router.use('/employees', employeeRoutes);

// ── /api/v1/company/clients ──────────────────────────────────────────────────
router.use('/clients', clientRoutes);

// ── /api/v1/company/managers ─────────────────────────────────────────────────
router.use('/managers', managerRoutes);

// ── /api/v1/company/members ──────────────────────────────────────────────────
router.use('/members', memberRoutes);

export default router;
