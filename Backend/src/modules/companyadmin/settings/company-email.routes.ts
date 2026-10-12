import { Router } from 'express';
import { CompanyEmailController } from './company-email.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import {
    updateCompanyEmailSchema,
    confirmEmailVerificationSchema,
    sendTestEmailSchema,
} from './company-email.validator';
import { authorizeRoles } from '../../../middleware/authorization.middleware';

const router = Router();

// ── GET /api/v1/company/settings/email ─────────────────────────────────────────
// Retrieve email settings and entitlement status
router.get(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.getEmailSettings
);

// ── GET /api/v1/company/settings/email/entitlement ─────────────────────────────
// Diagnostic endpoint for subscription email entitlement
router.get(
    '/entitlement',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.getEmailEntitlement
);

// ── PUT /api/v1/company/settings/email & PATCH /api/v1/company/settings/email ─
// Update custom sender email, display name, reply-to, and custom SMTP
router.put(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanyEmailSchema),
    CompanyEmailController.updateEmailSettings
);

router.patch(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(updateCompanyEmailSchema),
    CompanyEmailController.updateEmailSettings
);

// ── POST /api/v1/company/settings/email/verify/send ────────────────────────────
// Dispatch 6-digit verification code to the configured sender address
router.post(
    '/verify/send',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.sendVerificationCode
);

router.post(
    '/verify/request',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.sendVerificationCode
);

// ── POST /api/v1/company/settings/email/verify/confirm ─────────────────────────
// Confirm ownership with the 6-digit code
router.post(
    '/verify/confirm',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(confirmEmailVerificationSchema),
    CompanyEmailController.confirmVerificationCode
);

router.post(
    '/verify',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(confirmEmailVerificationSchema),
    CompanyEmailController.confirmVerificationCode
);

// ── POST /api/v1/company/settings/email/test ──────────────────────────────────
// Send test email to verify credentials and connectivity
router.post(
    '/test',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    validateRequest(sendTestEmailSchema),
    CompanyEmailController.sendTestEmail
);

// ── POST /api/v1/company/settings/email/reset & DELETE /api/v1/company/settings/email
// Reset to default platform sender mode
router.post(
    '/reset',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.resetEmailSettings
);

router.delete(
    '/',
    authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'),
    CompanyEmailController.resetEmailSettings
);

export default router;
