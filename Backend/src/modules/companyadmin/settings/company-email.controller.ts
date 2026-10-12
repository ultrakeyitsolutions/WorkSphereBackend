import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { CompanyEmailService } from './company-email.service';
import { CompanyEmailEntitlementService } from './company-email-entitlement.service';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class CompanyEmailController {
    /**
     * Helper to resolve trusted company ID for authenticated request.
     * Non-Super Admin requests strictly resolve from trusted session context.
     * Super Admin requests can optionally supply query param ?companyId=xxx for cross-tenant operations.
     */
    private static resolveCompanyId(req: AuthenticatedRequest): string | null {
        if (req.user?.role === 'SUPER_ADMIN' && req.query.companyId) {
            return String(req.query.companyId);
        }
        return req.currentUser?.companyId || req.user?.companyId || null;
    }

    /**
     * GET /api/v1/company/settings/email
     * Retrieve email configuration, active sender mode, and subscription entitlement status.
     */
    static async getEmailSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const data = await CompanyEmailService.getEmailSettings(companyId);
            return sendSuccess(res, 'Company email settings retrieved successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to retrieve company email settings', 500);
        }
    }

    /**
     * GET /api/v1/company/settings/email/entitlement
     * Retrieve entitlement diagnostics for custom company email feature.
     */
    static async getEmailEntitlement(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
            return sendSuccess(res, 'Company email entitlement retrieved successfully', entitlement, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to retrieve company email entitlement', 500);
        }
    }

    /**
     * PUT /api/v1/company/settings/email & PATCH /api/v1/company/settings/email
     * Update custom sender email address, sender display name, and optional custom SMTP credentials.
     */
    static async updateEmailSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const updated = await CompanyEmailService.updateEmailSettings(
                companyId,
                req.body,
                userId,
                req
            );

            return sendSuccess(res, 'Company email settings updated successfully', updated, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to update company email settings', 500);
        }
    }

    /**
     * POST /api/v1/company/settings/email/verify/send
     * Dispatch a 6-digit verification code to the configured sender email.
     */
    static async sendVerificationCode(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const result = await CompanyEmailService.sendVerificationCode(companyId, userId, req);

            return sendSuccess(res, result.message, result, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to send verification code', 500);
        }
    }

    /**
     * POST /api/v1/company/settings/email/verify/confirm
     * Confirm verification code to verify ownership and enable company sender mode.
     */
    static async confirmVerificationCode(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const result = await CompanyEmailService.confirmVerificationCode(
                companyId,
                req.body.code,
                userId,
                req
            );

            return sendSuccess(res, result.message, result, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to confirm verification code', 500);
        }
    }

    /**
     * POST /api/v1/company/settings/email/test
     * Send a test email to verify sender and transport connectivity.
     */
    static async sendTestEmail(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const result = await CompanyEmailService.sendTestEmail(
                companyId,
                req.body?.recipientEmail,
                userId
            );

            return sendSuccess(res, result.message, result, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to send test email', 500);
        }
    }

    /**
     * POST /api/v1/company/settings/email/reset & DELETE /api/v1/company/settings/email
     * Reset email configuration to platform defaults.
     */
    static async resetEmailSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanyEmailController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const result = await CompanyEmailService.resetEmailSettings(companyId, userId, req);

            return sendSuccess(res, 'Company email settings reset to platform defaults', result, 200);
        } catch (error: any) {
            if (error instanceof AppError || error?.statusCode) {
                return sendError(res, error.message, error.statusCode || 500, error.errors);
            }
            return sendError(res, error.message || 'Failed to reset company email settings', 500);
        }
    }
}
