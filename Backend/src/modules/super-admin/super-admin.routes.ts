import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles, authorizePermissions } from '../../middleware/authorization.middleware';
import { CompanyController } from '../companies/company.controller';
import companyRoutes from '../companies/company.routes';

const router = Router();

// ─── Super-Admin Guard Pipeline ───────────────────────────────────────────────
// Every route under /api/super-admin/* MUST:
//   1. Carry a valid JWT access token  (authenticate)
//   2. Have the SUPER_ADMIN role       (authorizeRoles)
//   3. Carry the COMPANY_CREATE perm  (authorizePermissions — applied per sub-router)
//
// The permission check is scoped per resource so different sub-routers can
// require different permissions while sharing the same role guard.

// ── Apply authentication + role check to ALL super-admin routes ───────────────
router.use(authenticate, authorizeRoles('SUPER_ADMIN'));

// ── POST /api/super-admin/create-company ──────────────────────────────────────
// Additional permission required: COMPANY_CREATE (checked before company routes)
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

router.use('/companies', companiesRouter);

export default router;
