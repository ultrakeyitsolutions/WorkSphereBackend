import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { authenticate } from './auth.middleware';
import { ModuleAccessService } from '../modules/companyadmin/module-access/module-access.service';
import { ModuleKey } from '../modules/companyadmin/module-access/module-access.types';
import { SUPPORTED_MODULES } from '../modules/companyadmin/module-access/module-access.constants';
import { EntitlementService } from '../services/entitlement.service';
import { sendError } from '../utils/response';

/**
 * Express middleware to enforce Member Module Access.
 * Evaluates Plan Entitlements, Company Feature Flags, Company Global Setting, and Employee Overrides.
 * Super Admins bypass module checks.
 * Company Admins bypass member-level module overrides, but MUST satisfy company subscription entitlements.
 */
export const requireModuleAccess = (moduleKey: ModuleKey) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            if (!req.currentUser && !req.user) {
                return authenticate(req, res, () => {
                    return requireModuleAccess(moduleKey)(req, res, next);
                });
            }

            const rawRole = req.currentUser?.role || req.user?.role;
            const roleName = typeof rawRole === 'string' ? rawRole : (rawRole as any)?.name || '';
            if (roleName === 'SUPER_ADMIN') {
                return next();
            }

            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;

            if (!companyId) {
                return sendError(res, 'Company context not found', 403);
            }

            // Step 1: Enforce subscription plan entitlement if module requires one
            const mod = SUPPORTED_MODULES.find((m) => m.key === moduleKey);
            if (mod?.entitlement && companyId) {
                const details = await EntitlementService.getEntitlementDetails(companyId, mod.entitlement);
                if (details && !details.enabled) {
                    return sendError(
                        res,
                        `Your current subscription plan does not include '${mod.name}'. Please upgrade your subscription.`,
                        403,
                        { code: 'PLAN_UPGRADE_REQUIRED', featureKey: mod.entitlement, moduleKey }
                    );
                }
            }

            // Company Admin and Admin bypass member-level module restrictions (once subscription check passes)
            if (roleName === 'COMPANY_ADMIN' || roleName === 'Admin') {
                return next();
            }

            if (!userId) {
                return sendError(res, 'User context not found', 403);
            }

            // Step 2: Enforce member-specific effective module access
            const memberAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(
                companyId,
                userId
            );

            if (!memberAccess.effectiveModules[moduleKey]) {
                return sendError(
                    res,
                    `Access to the '${moduleKey}' module has been restricted for your account.`,
                    403,
                    { code: 'PERMISSION_DENIED', featureCode: 'FEATURE_ACCESS_DENIED', moduleKey }
                );
            }

            return next();
        } catch (error: any) {
            return sendError(res, error.message || 'Module access verification failed', 500);
        }
    };
};
