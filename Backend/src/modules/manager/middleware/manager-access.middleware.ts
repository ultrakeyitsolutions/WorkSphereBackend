import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { sendError } from '../../../utils/response';
import { TeamAccessService, ManagerAccessScope } from '../services/team-access.service';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { ManagerAssignment } from '../models/manager-assignment.model';
import { MANAGER_PERMISSIONS } from '../constants/manager.constants';

export interface ManagerRequest extends AuthenticatedRequest {
    managerScope?: ManagerAccessScope;
}

/**
 * Middleware ensuring caller has Manager authority or is CompanyAdmin / SuperAdmin.
 * Populates req.managerScope with resolved authorized scope.
 */
export const requireManagerWorkspace = async (
    req: ManagerRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user || !req.user.userId) {
            return sendError(res, 'Authentication required', 401);
        }

        const companyId = req.user.companyId;
        const userId = req.user.userId;
        const userRole = (req.user.role || '').toUpperCase();

        const isSuperAdmin = userRole === 'SUPER_ADMIN';
        const isCompanyAdmin = isSuperAdmin || userRole === 'COMPANY_ADMIN' || userRole === 'ADMIN';

        if (!companyId && !isSuperAdmin) {
            return sendError(res, 'Valid company context is required', 400);
        }

        const effectiveCompanyId = companyId || (req.query.companyId as string);
        if (!effectiveCompanyId) {
            return sendError(res, 'Company context required', 400);
        }

        // Check if manager module is enabled in company module access
        if (!isSuperAdmin) {
            const { ModuleAccessService } = await import('../../companyadmin/module-access/module-access.service.js');
            const isManagerModuleAllowed = await ModuleAccessService.isModuleAllowed(effectiveCompanyId, 'manager', userId);
            if (!isManagerModuleAllowed) {
                return sendError(res, 'Forbidden: Manager Workspace is disabled for this organization or user', 403);
            }
        }

        // Verify if user is an authorized manager or admin
        if (!isCompanyAdmin) {
            const [member, activeAssignmentCount] = await Promise.all([
                CompanyMember.findOne({ companyId: effectiveCompanyId, userId, status: 'ACTIVE' }).lean(),
                ManagerAssignment.countDocuments({
                    companyId: effectiveCompanyId,
                    managerId: userId,
                    isActive: true,
                    startDate: { $lte: new Date() },
                    $or: [{ endDate: null }, { endDate: { $gt: new Date() } }],
                }),
            ]);

            const isManagerMember = member?.memberType === 'MANAGER';
            const hasAssignments = activeAssignmentCount > 0;

            if (!isManagerMember && !hasAssignments) {
                return sendError(res, 'Forbidden: You do not have manager privileges in this organization', 403);
            }
        }

        // Resolve manager access scope
        const scope = await TeamAccessService.resolveScope(effectiveCompanyId, userId, userRole);

        if (scope.isSuspended) {
            return sendError(res, 'Forbidden: Your manager access has been temporarily suspended by administrator', 403);
        }

        req.managerScope = scope;
        return next();
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to authenticate manager workspace', err.statusCode || 500);
    }
};

/**
 * Middleware enforcing granular manager permissions.
 */
export const requireManagerPermission = (permission: string) => {
    return (req: ManagerRequest, res: Response, next: NextFunction) => {
        const scope = req.managerScope;
        if (!scope) {
            return sendError(res, 'Manager scope not resolved', 500);
        }

        if (scope.isCompanyAdmin || scope.isSuperAdmin) {
            return next();
        }

        if (!scope.permissions.includes(permission)) {
            return sendError(res, `Forbidden: Missing required manager permission: ${permission}`, 403);
        }

        return next();
    };
};
