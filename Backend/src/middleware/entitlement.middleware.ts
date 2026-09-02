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
        if (!req.user) {
            return sendError(res, 'User context not found', 401);
        }

        try {
            const user = await UserService.findById(req.user.userId);
            if (!user) {
                return sendError(res, 'User not found', 404);
            }

            const companyId = user.companyId as unknown as string | undefined;

            if (!companyId) {
                // Determine if they are SUPER_ADMIN and bypass? 
                // We could just block since this middleware is for company features.
                return sendError(res, 'No company context for this user', 403);
            }

            const hasAccess = await EntitlementService.canAccess(companyId, featureKey);

            if (!hasAccess) {
                return sendError(res, `Forbidden: Missing required feature entitlement: ${featureKey}`, 403);
            }

            return next();
        } catch {
            return sendError(res, 'Feature entitlement check failed', 500);
        }
    };
};
