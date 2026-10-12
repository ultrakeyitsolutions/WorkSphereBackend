import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { sendError } from '../utils/response';
import { UserService } from '../modules/users/user.service';
import { EntitlementService } from '../modules/super-admin/entitlements/entitlement.service';

/**
 * Middleware to enforce feature entitlement for the user's company.
 * Typically used for tenant/company users, not SUPER_ADMINs managing things.
 * Ensure it is placed AFTER authenticate middleware, so req.user exists.
 */
export const requireFeature = (featureKey: string) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const authUser = req.currentUser || req.user;
        if (!authUser) {
            return sendError(res, 'User context not found', 401);
        }

        try {
            const role = authUser.role;
            if (role === 'SUPER_ADMIN') {
                return next();
            }

            let companyId = authUser.companyId ? String(authUser.companyId) : undefined;

            if (!companyId) {
                const userId = (authUser as any).userId || (authUser as any)._id;
                if (userId) {
                    const user = await UserService.findById(String(userId));
                    if (user?.companyId) {
                        companyId = String(user.companyId);
                    }
                }
            }

            if (!companyId) {
                return sendError(res, 'No company context for this user', 403);
            }

            const hasAccess = await EntitlementService.canAccess(companyId, featureKey);

            if (!hasAccess) {
                return sendError(
                    res,
                    `Your current subscription plan does not include '${featureKey}'. Please upgrade your subscription.`,
                    403,
                    { code: 'PLAN_UPGRADE_REQUIRED', featureKey }
                );
            }

            return next();
        } catch {
            return sendError(res, 'Feature entitlement check failed', 500);
        }
    };
};
