import { Response, NextFunction } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { authorizeRoles } from '../../../middleware/authorization.middleware';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { sendError } from '../../../utils/response';

/**
 * Super Admin strict guard middleware.
 * Verifies that the request has an active token and the authenticating account
 * possesses the SUPER_ADMIN role.
 */
export const requireSuperAdmin = [
    authenticate,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        // Double check both req.authenticatedUser and req.user
        const role = req.authenticatedUser?.role || req.user?.role;
        if (role !== 'SUPER_ADMIN') {
            return sendError(res, 'Forbidden: Super Admin access required', 403);
        }
        return next();
    },
];

export default requireSuperAdmin;
