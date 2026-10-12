import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { FeatureAccessService, FeatureFlagKey } from '../modules/companyadmin/settings/feature-access.service';
import { sendError } from '../utils/response';

/**
 * Middleware to enforce Company Feature Flag and Subscription Entitlement.
 * Usage: router.use(requireCompanyFeature('enableLiveMonitoring'));
 */
export const requireCompanyFeature = (featureKey: FeatureFlagKey) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;

            // If SUPER_ADMIN without company context is managing system, allow bypass if not in company tenant route
            if (!companyId && req.user?.role === 'SUPER_ADMIN') {
                return next();
            }

            if (!companyId) {
                return sendError(res, 'Company context required for this feature', 403);
            }

            const result = await FeatureAccessService.checkAccess(companyId, featureKey);

            if (!result.allowed) {
                return sendError(
                    res,
                    result.message || `Feature '${featureKey}' is disabled or not entitled`,
                    403,
                    { code: result.reason }
                );
            }

            return next();
        } catch (error: any) {
            return sendError(res, error.message || 'Feature access check failed', 500);
        }
    };
};
