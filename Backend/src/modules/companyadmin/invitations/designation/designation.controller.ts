import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../auth/auth.types';
import { sendSuccess, sendError } from '../../../../utils/response';
import { DesignationService } from './designation.service';
import { validateData } from '../../../../middleware/validateRequest';
import {
    createDesignationSchema,
    updateDesignationSchema,
    setDesignationStatusSchema,
} from './designation.validator';

export class DesignationController {

    static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(createDesignationSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);
            if (!userId) return sendError(res, 'User context not found in token', 401);

            const designation = await DesignationService.create({
                companyId,
                name: parsed.data.name,
                description: parsed.data.description,
                createdBy: userId,
            });

            return sendSuccess(res, 'Designation created successfully', designation, 201);
        } catch (err: any) {
            if (err?.code === 11000) return sendError(res, 'A designation with this name already exists in your company', 409);
            next(err);
        }
    }

    static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const designations = await DesignationService.listByCompany(companyId);
            return sendSuccess(res, 'Designations fetched successfully', designations);
        } catch (err) { next(err); }
    }

    static async getOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const designation = await DesignationService.findByIdAndCompany(String(req.params.designationId), companyId);
            if (!designation) return sendError(res, 'Designation not found', 404);

            return sendSuccess(res, 'Designation fetched successfully', designation);
        } catch (err) { next(err); }
    }

    static async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(updateDesignationSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const designation = await DesignationService.update(String(req.params.designationId), companyId, parsed.data);
            return sendSuccess(res, 'Designation updated successfully', designation);
        } catch (err: any) {
            if (err?.code === 11000) return sendError(res, 'A designation with this name already exists in your company', 409);
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }

    static async setStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(setDesignationStatusSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const designation = await DesignationService.setStatus(String(req.params.designationId), companyId, parsed.data.isActive);
            return sendSuccess(res, `Designation ${parsed.data.isActive ? 'activated' : 'deactivated'} successfully`, designation);
        } catch (err: any) {
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }

    static async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            await DesignationService.delete(String(req.params.designationId), companyId);
            return sendSuccess(res, 'Designation deleted successfully');
        } catch (err: any) {
            if (err?.message?.includes('not found')) return sendError(res, err.message, 404);
            next(err);
        }
    }
}
