import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { sendError } from '../utils/response';
import { UserService } from '../modules/users/user.service';

export const authorizeRoles = (...allowedRoles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return sendError(res, 'User context not found', 401);
        }

        if (!allowedRoles.includes(req.user.role)) {
            return sendError(res, 'Forbidden: Insufficient role permissions', 403);
        }

        return next();
    };
};

export const authorizePermissions = (...requiredPermissions: string[]) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return sendError(res, 'User context not found', 401);
        }

        try {
            const user = await UserService.findById(req.user.userId);
            if (!user) {
                return sendError(res, 'User not found', 404);
            }

            const role = user.role as any;
            if (!role) {
                return sendError(res, 'Forbidden: No role assigned to user', 403);
            }

            // Admin and SUPER_ADMIN roles bypass permission checks
            if (role.name === 'Admin' || role.name === 'SUPER_ADMIN') {
                return next();
            }

            const userPermissions: string[] = (role.permissions || []).map(
                (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
            ).filter(Boolean);

            const hasAllPermissions = requiredPermissions.every((perm) =>
                userPermissions.includes(perm)
            );

            if (!hasAllPermissions) {
                return sendError(res, 'Forbidden: Missing required permissions', 403);
            }

            return next();
        } catch {
            return sendError(res, 'Authorization check failed', 500);
        }
    };
};
