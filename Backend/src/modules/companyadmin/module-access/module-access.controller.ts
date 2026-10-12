import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { ModuleAccessService } from './module-access.service';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { ModuleKey } from './module-access.types';

export class ModuleAccessController {
    /**
     * GET /api/v1/company/module-access/catalog
     * Retrieve the authoritative list of supported member sidebar modules
     */
    static async getModuleCatalog(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const catalog = ModuleAccessService.getModuleCatalog();
            return sendSuccess(res, 'Supported sidebar modules catalog retrieved successfully', catalog, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve module catalog', 500);
        }
    }

    /**
     * GET /api/v1/company/module-access
     * Get company global module visibility settings and statistics
     */
    static async getGlobalModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const data = await ModuleAccessService.getGlobalModuleAccess(companyId);
            return sendSuccess(res, 'Global module access settings retrieved', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve module access settings', 500);
        }
    }

    /**
     * PATCH /api/v1/company/module-access/global
     * Update global module visibility settings
     */
    static async updateGlobalModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId;
            const data = await ModuleAccessService.updateGlobalModuleAccess(
                companyId,
                req.body,
                userId
            );

            return sendSuccess(res, 'Global module access updated successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to update global module access', 500);
        }
    }

    /**
     * GET /api/v1/company/module-access/employees
     * Paginated list of employees with custom overrides and effective access
     */
    static async getEmployeesModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
            const search = req.query.search ? (req.query.search as string) : undefined;
            const memberType = req.query.memberType ? (req.query.memberType as string) : undefined;
            const overrideFilter = req.query.overrideFilter as any;
            const moduleKeyFilter = req.query.moduleKeyFilter as any;
            const moduleStatusFilter = req.query.moduleStatusFilter as any;

            let employeeIds: string[] | undefined;
            if (req.query.employeeIds) {
                if (Array.isArray(req.query.employeeIds)) {
                    employeeIds = req.query.employeeIds as string[];
                } else if (typeof req.query.employeeIds === 'string') {
                    employeeIds = (req.query.employeeIds as string).split(',').map((id) => id.trim()).filter(Boolean);
                }
            }

            const data = await ModuleAccessService.getEmployeesModuleAccess({
                companyId,
                employeeIds,
                page,
                limit,
                search,
                memberType,
                overrideFilter,
                moduleKeyFilter,
                moduleStatusFilter,
            });

            return sendSuccess(res, 'Employees module access retrieved successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve employees module access', 500);
        }
    }

    /**
     * POST /api/v1/company/module-access/selected
     * Retrieve access settings for multiple selected members with mixed state evaluation
     */
    static async getSelectedMembersModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const rawIds = req.body?.employeeIds || req.body?.memberIds || [];
            const data = await ModuleAccessService.getSelectedMembersModuleAccess(companyId, rawIds);

            return sendSuccess(res, 'Selected members module access retrieved successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve selected members module access', 500);
        }
    }

    /**
     * GET /api/v1/company/module-access/employees/:employeeId
     * Individual employee module access breakdown
     */
    static async getSingleEmployeeModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const employeeId = String(req.params.employeeId);
            const data = await ModuleAccessService.getSingleEmployeeModuleAccess(companyId, employeeId);

            return sendSuccess(res, 'Employee module access retrieved successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve employee module access', 500);
        }
    }

    /**
     * PATCH /api/v1/company/module-access/employees/:employeeId
     * Update individual employee overrides
     */
    static async updateEmployeeModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const employeeId = String(req.params.employeeId);
            const userId = req.currentUser?.userId || req.user?.userId;

            const data = await ModuleAccessService.updateEmployeeModuleAccess(
                companyId,
                employeeId,
                req.body,
                userId
            );

            return sendSuccess(res, 'Employee module override updated successfully', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to update employee override', 500);
        }
    }

    /**
     * DELETE /api/v1/company/module-access/employees/:employeeId/overrides/:moduleKey
     * Reset individual employee override to INHERIT
     */
    static async resetEmployeeOverride(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const employeeId = String(req.params.employeeId);
            const moduleKey = String(req.params.moduleKey);
            const userId = req.currentUser?.userId || req.user?.userId;

            const data = await ModuleAccessService.resetEmployeeOverride(
                companyId,
                employeeId,
                moduleKey as ModuleKey,
                userId
            );

            return sendSuccess(res, `Module override for '${moduleKey}' reset to inherit`, data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to reset employee override', 500);
        }
    }

    /**
     * POST /api/v1/company/module-access/bulk
     * Bulk update module overrides for multiple employees
     */
    static async bulkUpdateEmployeeOverrides(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            if (!companyId) {
                return sendError(res, 'Company context not found', 400);
            }

            const userId = req.currentUser?.userId || req.user?.userId;
            const data = await ModuleAccessService.bulkUpdateEmployeeModuleAccess(
                companyId,
                req.body,
                userId
            );

            return sendSuccess(res, data.message, data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to bulk update employee overrides', 500);
        }
    }

    /**
     * GET /api/v1/member/module-access/me or /api/v1/company/module-access/me
     * Member-facing endpoint returning effective module visibility
     */
    static async getMyEffectiveModuleAccess(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const companyId = req.currentUser?.companyId || req.user?.companyId;
            const userId = req.currentUser?.userId || req.user?.userId;

            if (!companyId || !userId) {
                return sendError(res, 'User or Company context not found', 400);
            }

            const data = await ModuleAccessService.getEffectiveMemberModuleAccess(companyId, userId);
            return sendSuccess(res, 'Effective module access retrieved', data, 200);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve effective module access', 500);
        }
    }
}
