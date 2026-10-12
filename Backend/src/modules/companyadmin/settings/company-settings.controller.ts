import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { CompanySettingsService } from './company-settings.service';
import { CompanyThemeService } from './company-theme.service';
import { CompanyThemeEntitlementService } from './company-theme-entitlement.service';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class CompanySettingsController {
    /**
     * Helper to resolve trusted company ID for authenticated request.
     * Non-Super Admin requests strictly resolve from trusted session (req.currentUser/req.user).
     * Super Admin requests can optionally supply query param ?companyId=xxx for cross-tenant operations.
     */
    private static resolveCompanyId(req: AuthenticatedRequest): string | null {
        if (req.user?.role === 'SUPER_ADMIN' && req.query.companyId) {
            return String(req.query.companyId);
        }
        return req.currentUser?.companyId || req.user?.companyId || null;
    }

    /**
     * GET /api/v1/company/settings
     * Retrieve the settings for the authenticated user's authorized company.
     */
    static async getSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const settings = await CompanySettingsService.getSettings(companyId);
            return sendSuccess(res, 'Company settings retrieved successfully', settings, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to retrieve company settings', 500);
        }
    }

    /**
     * PUT /api/v1/company/settings & PATCH /api/v1/company/settings
     * Validate and update permitted company settings.
     */
    static async updateSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId;
            const updatedSettings = await CompanySettingsService.updateSettings(
                companyId,
                req.body,
                userId || '',
                req
            );

            return sendSuccess(res, 'Company settings updated successfully', updatedSettings, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to update company settings', 500);
        }
    }

    /**
     * GET /api/v1/company/settings/theme
     * Retrieve company theme configuration. Accessible to all authenticated users of the company
     * (Company Admins, Employees, Managers, Clients, etc.).
     */
    static async getTheme(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const theme = await CompanyThemeService.getTheme(companyId);
            return sendSuccess(res, 'Company theme retrieved successfully', theme, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to retrieve company theme', 500);
        }
    }

    /**
     * GET /api/v1/company/settings/theme/entitlement
     * Retrieve authoritative theme subscription entitlement status for Company Admin.
     */
    static async getThemeEntitlement(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const entitlement = await CompanyThemeEntitlementService.checkEntitlement(companyId);
            return sendSuccess(res, 'Company theme entitlement retrieved successfully', entitlement, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to retrieve company theme entitlement', 500);
        }
    }

    /**
     * PUT /api/v1/company/settings/theme & PATCH /api/v1/company/settings/theme
     * Authoritatively updates company theme with WCAG contrast validation.
     * Restricted to COMPANY_ADMIN, Admin, and SUPER_ADMIN.
     */
    static async updateTheme(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const updatedTheme = await CompanyThemeService.updateTheme(
                companyId,
                req.body,
                userId,
                req
            );

            return sendSuccess(res, 'Company theme updated successfully', updatedTheme, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to update company theme', 500);
        }
    }

    /**
     * POST /api/v1/company/settings/theme/reset & DELETE /api/v1/company/settings/theme
     * Resets company theme to standard WorkSphere defaults.
     * Restricted to COMPANY_ADMIN, Admin, and SUPER_ADMIN.
     */
    static async resetTheme(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = CompanySettingsController.resolveCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId || '';
            const defaultTheme = await CompanyThemeService.resetTheme(companyId, userId, req);

            return sendSuccess(res, 'Company theme reset to defaults successfully', defaultTheme, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode, error.errors);
            }
            return sendError(res, error.message || 'Failed to reset company theme', 500);
        }
    }
}

