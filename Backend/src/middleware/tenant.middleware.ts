import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { Company } from '../modules/super-admin/companies/company.model';
import { WhiteLabelSettings } from '../modules/super-admin/white-label/white-label.model';
import { sendError } from '../utils/response';

/**
 * Sanitizes and extracts the clean hostname, stripping any port numbers and preventing header injection.
 */
export const sanitizeHostHeader = (rawHost?: string): string | null => {
    if (!rawHost) return null;
    const clean = rawHost.trim().split(':')[0].toLowerCase();
    // Validate domain pattern: alphanumeric, dashes, dots
    if (!/^[a-zA-Z0-9.-]+$/.test(clean)) {
        return null;
    }
    return clean;
};

/**
 * Middleware: Resolves tenant context from request headers, subdomain, or query parameters.
 * Validates against Host-header spoofing.
 */
export const resolveTenantContext = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const rawHost = req.headers.host || (req.headers['x-forwarded-host'] as string);
        const cleanHost = sanitizeHostHeader(rawHost);

        const headerSlug = (req.headers['x-tenant-slug'] || req.headers['x-workspace']) as string;
        const headerTenantId = req.headers['x-tenant-id'] as string;
        const querySlug = (req.query.workspace || req.query.slug) as string;

        let company: any = null;

        // 1. Resolve by explicit header tenantId
        if (headerTenantId) {
            company = await Company.findOne({
                tenantId: headerTenantId,
                status: { $ne: 'DELETED' },
            });
        }

        // 2. Resolve by workspace slug
        const targetSlug = headerSlug || querySlug;
        if (!company && targetSlug) {
            company = await Company.findOne({
                slug: targetSlug.toLowerCase().trim(),
                status: { $ne: 'DELETED' },
            });
        }

        // 3. Resolve by hostname
        if (!company && cleanHost) {
            // First check verified custom domain in WhiteLabelSettings
            const whiteLabelDoc = await WhiteLabelSettings.findOne({
                customDomain: cleanHost,
                domainVerificationStatus: 'VERIFIED',
            });
            if (whiteLabelDoc) {
                company = await Company.findOne({
                    _id: whiteLabelDoc.companyId,
                    status: { $ne: 'DELETED' },
                });
            }

            // Next check company.domain
            if (!company) {
                company = await Company.findOne({
                    domain: cleanHost,
                    status: { $ne: 'DELETED' },
                });
            }

            // Check subdomain if not on base domains
            if (!company) {
                const parts = cleanHost.split('.');
                if (parts.length >= 2) {
                    const subdomain = parts[0];
                    if (subdomain !== 'api' && subdomain !== 'www' && subdomain !== 'app' && subdomain !== 'admin') {
                        company = await Company.findOne({
                            slug: subdomain,
                            status: { $ne: 'DELETED' },
                        });
                    }
                }
            }
        }

        if (company) {
            req.resolvedTenant = {
                companyId: String(company._id),
                tenantId: company.tenantId || String(company._id),
                slug: company.slug,
                name: company.name,
                status: company.status,
            };
            req.tenantId = company.tenantId || String(company._id);
            req.tenantSlug = company.slug;
        }

        return next();
    } catch (err: any) {
        return sendError(res, 'Failed to resolve tenant context', 500);
    }
};

/**
 * Middleware: Enforces tenant isolation on protected requests.
 * Never trusts a client-supplied tenantId as proof of authorization!
 * Validates that authenticated user can ONLY access resources within their assigned tenant.
 */
export const requireTenantScope = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    const user = req.user;
    if (!user) {
        return sendError(res, 'Authentication required', 401);
    }

    // SuperAdmin has platform-wide authority
    if (user.role === 'SUPER_ADMIN') {
        return next();
    }

    const authenticatedCompanyId = user.companyId ? String(user.companyId) : null;
    const authenticatedTenantId = user.tenantId || authenticatedCompanyId;

    if (!authenticatedCompanyId) {
        return sendError(res, 'User is not assigned to any organization', 403);
    }

    // Check if the request specifies a target company / tenant in params, headers, or body
    const paramCompanyId = (req.params.companyId || req.params.tenantId) as string;
    const headerCompanyId = (req.headers['x-tenant-id'] || req.headers['x-company-id']) as string;
    const bodyCompanyId = req.body?.companyId as string;

    const targetCompanyId = paramCompanyId || headerCompanyId || bodyCompanyId;

    if (targetCompanyId) {
        const isMatch =
            targetCompanyId === authenticatedCompanyId ||
            targetCompanyId === authenticatedTenantId;

        if (!isMatch) {
            return sendError(
                res,
                'Cross-tenant access forbidden. You cannot access or modify resources belonging to another organization.',
                403
            );
        }
    }

    // Attach verified tenant context to request
    req.tenantId = authenticatedTenantId || undefined;
    req.tenantSlug = user.tenantSlug;

    return next();
};

/**
 * Middleware: Ensures the user's company is currently ACTIVE and not SUSPENDED.
 */
export const verifyTenantActive = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    const user = req.user;
    if (!user || user.role === 'SUPER_ADMIN') {
        return next();
    }

    if (user.companyId) {
        const company = await Company.findById(user.companyId);
        if (!company) {
            return sendError(res, 'Organization account not found', 404);
        }

        if (company.status === 'SUSPENDED') {
            return sendError(res, 'Your organization account is currently suspended. Access denied.', 403);
        }

        if (company.status === 'DELETED' || !company.isActive) {
            return sendError(res, 'Your organization account is no longer active.', 403);
        }
    }

    return next();
};

export default {
    resolveTenantContext,
    requireTenantScope,
    verifyTenantActive,
    sanitizeHostHeader,
};
