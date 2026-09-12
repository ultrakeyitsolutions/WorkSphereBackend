import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles, authorizePermissions } from '../../middleware/authorization.middleware';
import { CompanyController } from './companies/company.controller';
import companyRoutes from './companies/company.routes';
import planRouter from './plans/plans.routes';
import featureRouter from './features/features.routes';
import subscriptionRoutes from './subscriptions/subscription.routes';
import auditLogRouter from '../audit-logs/audit-log.routes';
import storageRouter from './storage/storage-config.routes';

const router = Router();

// ─── Super-Admin Guard Pipeline ───────────────────────────────────────────────
// Every route under /api/super-admin/* MUST:
//   1. Carry a valid JWT access token  (authenticate)
//   2. Have the SUPER_ADMIN role       (authorizeRoles)
//   3. Carry the required permission   (authorizePermissions — applied per sub-router)

// ── Apply authentication + role check to ALL super-admin routes ───────────────
router.use(authenticate, authorizeRoles('SUPER_ADMIN'));

// ── POST /api/super-admin/create-company ──────────────────────────────────────
router.use(
    '/create-company',
    authorizePermissions('COMPANY_CREATE'),
    companyRoutes
);

// ── GET /api/super-admin/getcompanies ─────────────────────────────────────────
router.get(
    '/getcompanies',
    authorizePermissions('COMPANY_READ'),
    CompanyController.getAll
);

// ── Company Management Routes ─────────────────────────────────────────────────
const companiesRouter = Router();

companiesRouter.get(
    '/:companyId',
    authorizePermissions('COMPANY_READ'),
    CompanyController.getOne
);

companiesRouter.patch(
    '/:companyId',
    authorizePermissions('COMPANY_UPDATE'),
    CompanyController.edit
);

companiesRouter.patch(
    '/:companyId/suspend',
    authorizePermissions('COMPANY_SUSPEND'),
    CompanyController.suspend
);

companiesRouter.patch(
    '/:companyId/activate',
    authorizePermissions('COMPANY_ACTIVATE'),
    CompanyController.activate
);

companiesRouter.delete(
    '/:companyId',
    authorizePermissions('COMPANY_DELETE'),
    CompanyController.delete
);

companiesRouter.post(
    '/:companyId/admin/reset-password',
    authorizePermissions('COMPANY_ADMIN_PASSWORD_RESET'),
    CompanyController.resetAdminPassword
);

companiesRouter.use('/:companyId/subscription', subscriptionRoutes);
router.use('/companies', companiesRouter);

// ── Plan Management Routes ────────────────────────────────────────────────────
// GET    /api/super-admin/plans
// GET    /api/super-admin/plans/:id
// POST   /api/super-admin/plans
// PATCH  /api/super-admin/plans/:id
// DELETE /api/super-admin/plans/:id
router.use('/plans', planRouter);

// ── Feature Management Routes ─────────────────────────────────────────────────
// POST   /api/super-admin/features
// GET    /api/super-admin/features
// GET    /api/super-admin/features/:id
// PATCH  /api/super-admin/features/:id
// DELETE /api/super-admin/features/:id
router.use('/features', featureRouter);

// ── Audit Log Routes (Super-Admin only) ──────────────────────────────────────
// GET  /api/super-admin/audit-logs
// GET  /api/super-admin/audit-logs/stats
// GET  /api/super-admin/audit-logs/company/:companyId
// GET  /api/super-admin/audit-logs/:id
router.use('/audit-logs', auditLogRouter);

// ── Storage Configuration Routes (Super-Admin only) ─────────────────────────
// GET    /api/super-admin/storage/configuration
// PUT    /api/super-admin/storage/configuration
// POST   /api/super-admin/storage/test
// GET    /api/super-admin/storage/health
// GET    /api/super-admin/storage/history
// POST   /api/super-admin/storage/rollback/:historyId
router.use('/storage', storageRouter);

export default router;
