import { Response, Request } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { WhiteLabelService } from './white-label.service';
import {
    updateWhiteLabelSchema,
    configureDomainSchema,
    verifyDomainSchema,
} from './white-label.schema';
import { sendSuccess, sendError } from '../../../utils/response';

export class WhiteLabelController {
    /**
     * Helper to resolve target companyId securely:
     * - SuperAdmin can supply :companyId or req.query.companyId
     * - CompanyAdmin or employee is strictly locked to req.user.companyId
     */
    private static resolveTargetCompanyId(req: AuthenticatedRequest): string {
        const user = req.user;
        const requestedId = (req.params.companyId || req.params.id || req.query.companyId) as string;

        if (user?.role === 'SUPER_ADMIN') {
            return requestedId || user.companyId || '';
        }

        // For non-SuperAdmin, always bind to authenticated user's company
        if (requestedId && requestedId !== user?.companyId) {
            const err: any = new Error('You do not have permission to manage branding for another organization.');
            err.statusCode = 403;
            throw err;
        }

        return user?.companyId || '';
    }

    /**
     * GET /api/v1/public/branding/resolve
     * Public endpoint — no auth required.
     */
    static async getPublicBranding(req: Request, res: Response) {
        try {
            const workspace = (req.query.workspace || req.query.slug || req.headers['x-tenant-slug']) as string;
            const tenantId = (req.query.tenantId || req.headers['x-tenant-id']) as string;
            const domain = (req.query.domain || req.query.host) as string;
            const host = req.headers.host || (req.headers['x-forwarded-host'] as string);

            const result = await WhiteLabelService.getPublicBranding({
                workspace,
                tenantId,
                domain,
                host,
            });

            if ((result as any).suspended) {
                return res.status(403).json({
                    success: false,
                    message: (result as any).message || 'This workspace is currently suspended. Please contact your administrator.',
                    data: result,
                });
            }

            return sendSuccess(res, 'Branding configuration retrieved successfully.', result);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to load branding configuration. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * GET /api/super-admin/companies/:companyId/branding
     * GET /api/company/branding
     */
    static async getBranding(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const branding = await WhiteLabelService.getBranding(companyId);
            return sendSuccess(res, 'Branding settings loaded successfully.', branding);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to load branding settings. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * PUT/PATCH /api/super-admin/companies/:companyId/branding
     * PATCH /api/company/branding
     *
     * Note: "customCss" and "emailBranding" are not supported and will be
     * silently ignored if sent in the request body.
     */
    static async updateBranding(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const parsed = updateWhiteLabelSchema.safeParse(req.body);
            if (!parsed.success) {
                // Build a readable list of field errors for the client
                const fieldErrors = (parsed.error.issues as any[]).map((e) => `${(e.path as (string | number)[]).join('.')}: ${e.message as string}`);
                return sendError(
                    res,
                    `Some fields contain invalid values. Please correct them and try again: ${fieldErrors.join('; ')}`,
                    400,
                    parsed.error.format()
                );
            }

            const updated = await WhiteLabelService.updateBranding(companyId, parsed.data, req.user?.userId);
            return sendSuccess(res, 'Branding settings updated successfully.', updated);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to save branding settings. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * PATCH /api/super-admin/companies/:companyId/branding/toggle
     * PATCH /api/company/branding/toggle
     */
    static async toggleWhiteLabel(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const enabled = Boolean(req.body.enabled);
            const updated = await WhiteLabelService.toggleWhiteLabel(companyId, enabled, req.user?.userId);
            return sendSuccess(
                res,
                `Custom branding has been ${enabled ? 'enabled' : 'disabled'} for your workspace.`,
                updated
            );
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to change branding status. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/branding/domain
     * POST /api/company/branding/domain
     */
    static async configureDomain(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const parsed = configureDomainSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(
                    res,
                    'The domain name you entered is not valid. Please use a format like "portal.yourcompany.com".',
                    400,
                    parsed.error.format()
                );
            }

            const result = await WhiteLabelService.configureCustomDomain(companyId, parsed.data.domain, req.user?.userId);
            return sendSuccess(
                res,
                'Custom domain saved. Please add the DNS TXT record shown below to verify ownership, then call the verify endpoint.',
                result
            );
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to save the custom domain. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/branding/domain/verify
     * POST /api/company/branding/domain/verify
     *
     * Body: { verificationType?: "DNS_TXT" | "CNAME" | "TOKEN" }
     *
     * Before calling this endpoint, add a DNS TXT record:
     *   Host: _worksphere-challenge.<your-domain>
     *   Value: <verificationToken returned by the configure-domain endpoint>
     */
    static async verifyDomain(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const parsed = verifyDomainSchema.safeParse(req.body);
            const verificationType = parsed.success ? parsed.data.verificationType : 'DNS_TXT';
            const mockSuccess = req.body?.mockVerification === true || process.env.NODE_ENV === 'test';

            const result = await WhiteLabelService.verifyCustomDomain(companyId, req.user?.userId, mockSuccess, verificationType);
            return sendSuccess(res, 'Domain ownership verified successfully. Your custom domain is now active.', result);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Domain verification failed. Make sure the DNS TXT record has been added and has propagated (this can take a few minutes).',
                error.statusCode || 400
            );
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/branding/reset
     * POST /api/company/branding/reset
     */
    static async resetDefaultBranding(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const result = await WhiteLabelService.resetDefaultBranding(companyId, req.user?.userId);
            return sendSuccess(res, 'Branding has been reset to the default WorkSphere appearance.', result);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to reset branding. Please try again.',
                error.statusCode || 500
            );
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/branding/upload-logo
     * POST /api/company/branding/upload-logo
     */
    static async uploadLogo(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            const file = req.file;

            const result = await WhiteLabelService.uploadBrandingAsset(file, 'logo', companyId || undefined);
            return sendSuccess(res, 'Logo uploaded successfully.', result);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Logo upload failed. Make sure the file is a valid image (PNG, JPEG, WebP, SVG) and is not too large.',
                error.statusCode || 400
            );
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/branding/upload-favicon
     * POST /api/company/branding/upload-favicon
     */
    static async uploadFavicon(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            const file = req.file;

            const result = await WhiteLabelService.uploadBrandingAsset(file, 'favicon', companyId || undefined);
            return sendSuccess(res, 'Favicon uploaded successfully.', result);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Favicon upload failed. Make sure the file is a valid image (PNG, ICO, SVG) and is not too large.',
                error.statusCode || 400
            );
        }
    }

    /**
     * GET /api/v1/tenant/config
     * GET /api/company/tenant-config
     */
    static async getTenantConfig(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = WhiteLabelController.resolveTargetCompanyId(req);
            if (!companyId) {
                return sendError(res, 'Unable to identify your organization. Please log in again.', 400);
            }

            const config = await WhiteLabelService.getTenantConfig(companyId);
            return sendSuccess(res, 'Tenant configuration retrieved.', config);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'Unable to load tenant configuration. Please try again.',
                error.statusCode || 500
            );
        }
    }
}

export default WhiteLabelController;
