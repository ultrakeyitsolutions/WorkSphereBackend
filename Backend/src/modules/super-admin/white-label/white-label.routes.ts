import { Router } from 'express';
import multer from 'multer';
import { WhiteLabelController } from './white-label.controller';
import { authenticate } from '../../../middleware/auth.middleware';
import { authorizeRoles } from '../../../middleware/authorization.middleware';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
});

// ─── Company Admin White-Label Router ─────────────────────────────────────────
// Mounted at /api/company/branding and /api/v1/company/branding
export const companyBrandingRouter = Router();

companyBrandingRouter.use(authenticate, authorizeRoles('COMPANY_ADMIN', 'SUPER_ADMIN'));

// GET    /api/company/branding
companyBrandingRouter.get('/', WhiteLabelController.getBranding);

// PATCH  /api/company/branding
companyBrandingRouter.patch('/', WhiteLabelController.updateBranding);

// PATCH  /api/company/branding/toggle
companyBrandingRouter.patch('/toggle', WhiteLabelController.toggleWhiteLabel);

// POST   /api/company/branding/domain
companyBrandingRouter.post('/domain', WhiteLabelController.configureDomain);

// POST   /api/company/branding/domain/verify
companyBrandingRouter.post('/domain/verify', WhiteLabelController.verifyDomain);

// POST   /api/company/branding/reset
companyBrandingRouter.post('/reset', WhiteLabelController.resetDefaultBranding);

// POST   /api/company/branding/upload-logo
companyBrandingRouter.post('/upload-logo', upload.single('file'), WhiteLabelController.uploadLogo);

// POST   /api/company/branding/upload-favicon
companyBrandingRouter.post('/upload-favicon', upload.single('file'), WhiteLabelController.uploadFavicon);

// GET    /api/company/branding/tenant-config
companyBrandingRouter.get('/tenant-config', WhiteLabelController.getTenantConfig);


// ─── SuperAdmin White-Label Router ────────────────────────────────────────────
// Mounted at /api/super-admin/companies/:companyId/branding
export const superAdminCompanyBrandingRouter = Router({ mergeParams: true });

superAdminCompanyBrandingRouter.use(authenticate, authorizeRoles('SUPER_ADMIN'));

superAdminCompanyBrandingRouter.get('/', WhiteLabelController.getBranding);
superAdminCompanyBrandingRouter.patch('/', WhiteLabelController.updateBranding);
superAdminCompanyBrandingRouter.patch('/toggle', WhiteLabelController.toggleWhiteLabel);
superAdminCompanyBrandingRouter.post('/domain', WhiteLabelController.configureDomain);
superAdminCompanyBrandingRouter.post('/domain/verify', WhiteLabelController.verifyDomain);
superAdminCompanyBrandingRouter.post('/reset', WhiteLabelController.resetDefaultBranding);
superAdminCompanyBrandingRouter.post('/upload-logo', upload.single('file'), WhiteLabelController.uploadLogo);
superAdminCompanyBrandingRouter.post('/upload-favicon', upload.single('file'), WhiteLabelController.uploadFavicon);
superAdminCompanyBrandingRouter.get('/tenant-config', WhiteLabelController.getTenantConfig);

export default companyBrandingRouter;
