import { Router } from 'express';
import { ModuleAccessController } from './module-access.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    updateGlobalModuleAccessSchema,
    updateEmployeeOverrideSchema,
    bulkUpdateEmployeeOverridesSchema,
    resetEmployeeOverrideParamsSchema,
    selectedMembersQuerySchema,
} from './module-access.validator';
import { authorizeRoles } from '../../../middleware/authorization.middleware';

const router = Router();

// ── GET /api/v1/company/module-access/me (Accessible to any authenticated user in company) ──
router.get('/me', ModuleAccessController.getMyEffectiveModuleAccess);

// ── GET /api/v1/company/module-access/catalog (Supported module catalog & metadata) ──
router.get('/catalog', ModuleAccessController.getModuleCatalog);

// ── GET /api/v1/company/module-access (Global settings and metadata) ──────────
router.get(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    ModuleAccessController.getGlobalModuleAccess
);

// ── PATCH /api/v1/company/module-access/global (Update global toggles) ─────────
router.patch(
    '/global',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateGlobalModuleAccessSchema),
    ModuleAccessController.updateGlobalModuleAccess
);

// ── POST /api/v1/company/module-access/selected (Fetch access & mixed states for selected members) ──
router.post(
    '/selected',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(selectedMembersQuerySchema),
    ModuleAccessController.getSelectedMembersModuleAccess
);

// ── GET /api/v1/company/module-access/employees (Paginated list of employees with access) ──
router.get(
    '/employees',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    ModuleAccessController.getEmployeesModuleAccess
);

// ── GET /api/v1/company/module-access/employees/:employeeId ───────────────────
router.get(
    '/employees/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    ModuleAccessController.getSingleEmployeeModuleAccess
);

router.get(
    '/members/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    ModuleAccessController.getSingleEmployeeModuleAccess
);

// ── PATCH /api/v1/company/module-access/employees/:employeeId ─────────────────
router.patch(
    '/employees/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateEmployeeOverrideSchema),
    ModuleAccessController.updateEmployeeModuleAccess
);

router.patch(
    '/members/:employeeId',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateEmployeeOverrideSchema),
    ModuleAccessController.updateEmployeeModuleAccess
);

// ── DELETE /api/v1/company/module-access/employees/:employeeId/overrides/:moduleKey ──
router.delete(
    '/employees/:employeeId/overrides/:moduleKey',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(resetEmployeeOverrideParamsSchema),
    ModuleAccessController.resetEmployeeOverride
);

router.delete(
    '/members/:employeeId/overrides/:moduleKey',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(resetEmployeeOverrideParamsSchema),
    ModuleAccessController.resetEmployeeOverride
);

// ── POST /api/v1/company/module-access/bulk (Bulk update overrides) ───────────
router.post(
    '/bulk',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(bulkUpdateEmployeeOverridesSchema),
    ModuleAccessController.bulkUpdateEmployeeOverrides
);

export default router;
