import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AccountRecoveryController } from './account-recovery.controller';
import { requireSuperAdmin } from '../../super-admin/shared/super-admin-guard';

// ── Rate Limiters for Public Recovery Endpoints ──────────────────────────────
const publicRecoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // 10 attempts per IP
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many recovery requests from this IP. Please wait 15 minutes and try again.',
    },
});

const completeRecoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many recovery completion attempts. Please wait 15 minutes and try again.',
    },
});

// ── Public Routes Router ─────────────────────────────────────────────────────
export const publicAccountRecoveryRouter = Router();

// POST /api/v1/public/account-recovery-requests
publicAccountRecoveryRouter.post(
    '/account-recovery-requests',
    publicRecoveryLimiter,
    AccountRecoveryController.createRequest
);

// GET /api/v1/public/account-recovery-requests/:requestId/status
publicAccountRecoveryRouter.get(
    '/account-recovery-requests/:requestId/status',
    AccountRecoveryController.getStatus
);

// POST /api/v1/public/account-recovery-requests/:requestId/complete
publicAccountRecoveryRouter.post(
    '/account-recovery-requests/:requestId/complete',
    completeRecoveryLimiter,
    AccountRecoveryController.completeRecovery
);

// ── SuperAdmin Protected Router ──────────────────────────────────────────────
export const superAdminAccountRecoveryRouter = Router();

// Enforce authentication & SUPER_ADMIN role on all admin endpoints
superAdminAccountRecoveryRouter.use(requireSuperAdmin);

// GET /api/v1/superadmin/account-recovery-requests
superAdminAccountRecoveryRouter.get(
    '/account-recovery-requests',
    AccountRecoveryController.listRequests
);

// GET /api/v1/superadmin/account-recovery-requests/:requestId
superAdminAccountRecoveryRouter.get(
    '/account-recovery-requests/:requestId',
    AccountRecoveryController.getRequestById
);

// POST /api/v1/superadmin/account-recovery-requests/:requestId/approve
superAdminAccountRecoveryRouter.post(
    '/account-recovery-requests/:requestId/approve',
    AccountRecoveryController.approveRequest
);

// POST /api/v1/superadmin/account-recovery-requests/:requestId/reject
superAdminAccountRecoveryRouter.post(
    '/account-recovery-requests/:requestId/reject',
    AccountRecoveryController.rejectRequest
);

export default {
    publicRouter: publicAccountRecoveryRouter,
    superAdminRouter: superAdminAccountRecoveryRouter,
};
