import { Router } from 'express';
import { CompanySettingsController } from './company-settings.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import { updateCompanySettingsSchema } from './company-settings.validator';
import { updateCompanyThemeSchema } from './company-theme.validator';
import { authorizeRoles } from '../../../middleware/authorization.middleware';

const router = Router();

// ── GET /api/v1/company/settings ──────────────────────────────────────────────
router.get(
    '/',
    CompanySettingsController.getSettings
);

// ── PUT /api/v1/company/settings ──────────────────────────────────────────────
router.put(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanySettingsSchema),
    CompanySettingsController.updateSettings
);

// ── PATCH /api/v1/company/settings ────────────────────────────────────────────
router.patch(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanySettingsSchema),
    CompanySettingsController.updateSettings
);

// ── GET /api/v1/company/settings/theme ────────────────────────────────────────
// Accessible to any authenticated user in the company (Company Admin, Employee, Manager, etc.)
router.get(
    '/theme',
    CompanySettingsController.getTheme
);

// ── GET /api/v1/company/settings/theme/entitlement ────────────────────────────
// Dedicated entitlement diagnostic endpoint for authorized Company Admins & Super Admins
router.get(
    '/theme/entitlement',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanySettingsController.getThemeEntitlement
);

// ── PUT /api/v1/company/settings/theme ────────────────────────────────────────
// Authoritative theme update with WCAG contrast validation
router.put(
    '/theme',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanyThemeSchema),
    CompanySettingsController.updateTheme
);

// ── PATCH /api/v1/company/settings/theme ──────────────────────────────────────
router.patch(
    '/theme',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanyThemeSchema),
    CompanySettingsController.updateTheme
);

// ── POST /api/v1/company/settings/theme/reset ─────────────────────────────────
router.post(
    '/theme/reset',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanySettingsController.resetTheme
);

// ── DELETE /api/v1/company/settings/theme ─────────────────────────────────────
router.delete(
    '/theme',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanySettingsController.resetTheme
);

import companyEmailRoutes from './company-email.routes';

// ── /api/v1/company/settings/email ────────────────────────────────────────────
router.use('/email', companyEmailRoutes);

export default router;

