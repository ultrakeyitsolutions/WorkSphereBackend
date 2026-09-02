import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../auth/auth.types';
import { sendSuccess, sendError } from '../../../../utils/response';
import { CompanyRoleService } from './company-role.service';
import { validateData } from '../../../../middleware/validateRequest';
import {
    createRoleSchema,
    updateRoleSchema,
    setRoleStatusSchema,
} from './company-role.validator';

export class CompanyRoleController {

    /**
     * POST /api/v1/company/roles
     * Requires: authenticated user with a companyId
     */
    static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(createRoleSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            const userId = req.user?.userId;

            if (!companyId) return sendError(res, 'Company context not found in token', 403);
            if (!userId) return sendError(res, 'User context not found in token', 401);

            const role = await CompanyRoleService.create({
                companyId,
                name: parsed.data.name,
                description: parsed.data.description,
                createdBy: userId,
            });

            return sendSuccess(res, 'Role created successfully', role, 201);
        } catch (err: any) {
            if (err?.code === 11000) {
                return sendError(res, 'A role with this name already exists in your company', 409);
            }
            next(err);
        }
    }

    /**
     * GET /api/v1/company/roles
     */
    static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const roles = await CompanyRoleService.listByCompany(companyId);
            return sendSuccess(res, 'Roles fetched successfully', roles);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/company/roles/:roleId
     */
    static async getOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const role = await CompanyRoleService.findByIdAndCompany(String(req.params.roleId), companyId);
            if (!role) return sendError(res, 'Role not found', 404);

            return sendSuccess(res, 'Role fetched successfully', role);
        } catch (err) {
            next(err);
        }
    }

    /**
     * PUT /api/v1/company/roles/:roleId
     */
    static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(updateRoleSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const role = await CompanyRoleService.update(String(req.params.roleId), companyId, parsed.data);
            return sendSuccess(res, 'Role updated successfully', role);
        } catch (err: any) {
            if (err?.code === 11000) {
                return sendError(res, 'A role with this name already exists in your company', 409);
            }
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }

    /**
     * PATCH /api/v1/company/roles/:roleId/status
     */
    static async setStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(setRoleStatusSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const role = await CompanyRoleService.setStatus(String(req.params.roleId), companyId, parsed.data.isActive);
            return sendSuccess(res, `Role ${parsed.data.isActive ? 'activated' : 'deactivated'} successfully`, role);
        } catch (err: any) {
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }

    /**
     * DELETE /api/v1/company/roles/:roleId
     */
    static async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            await CompanyRoleService.delete(String(req.params.roleId), companyId);
            return sendSuccess(res, 'Role deleted successfully');
        } catch (err: any) {
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }
}
