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

            // Admin, SUPER_ADMIN, and COMPANY_ADMIN have full administrative access within their scope.
            if (
                role.name === 'Admin' ||
                role.name === 'SUPER_ADMIN' ||
                role.name === 'COMPANY_ADMIN'
            ) {
                return next();
            }

            const baseRolePermissions: string[] = (role.permissions || []).map(
                (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
            ).filter(Boolean);

            const grantedPermissions: string[] = ((user as any).grantedPermissions || []).map(
                (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
            ).filter(Boolean);

            const revokedPermissions: string[] = ((user as any).revokedPermissions || []).map(
                (perm: any) => (typeof perm === 'object' && perm ? perm.name : '')
            ).filter(Boolean);

            const effectivePermissionsSet = new Set(baseRolePermissions);
            grantedPermissions.forEach(perm => effectivePermissionsSet.add(perm));
            revokedPermissions.forEach(perm => effectivePermissionsSet.delete(perm));

            const effectivePermissions = Array.from(effectivePermissionsSet);

            const hasAllPermissions = requiredPermissions.every((perm) =>
                effectivePermissions.includes(perm)
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
