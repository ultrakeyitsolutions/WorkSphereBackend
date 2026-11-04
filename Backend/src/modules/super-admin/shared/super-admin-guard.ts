import { Response, NextFunction } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { sendError } from '../../../utils/response';

import { SuperAdminNotificationService } from '../notifications/super-admin-notification.service';

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
            const userEmail = req.authenticatedUser?.email || req.user?.email || 'Unknown User';
            const endpoint = `${req.method} ${req.originalUrl || req.url}`;
            const ip = req.ip || (req.socket as any)?.remoteAddress || 'Unknown IP';

            SuperAdminNotificationService.dispatch({
                type: 'UNAUTHORIZED_ACCESS_ATTEMPT',
                priority: 'CRITICAL',
                companyId: req.user?.companyId || null,
                actorId: req.user?.userId || null,
                eventId: `unauth_access_${req.user?.userId || ip}_${Date.now()}`,
                metadata: {
                    userEmail,
                    role: role || 'None',
                    endpoint,
                    ip,
                    method: req.method,
                },
            }).catch(() => {});

            return sendError(res, 'Forbidden: Super Admin access required', 403);
        }
        return next();
    },
];

export default requireSuperAdmin;
