import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { CompanyService } from './company.service';
import { createCompanySchema, editCompanySchema, suspendCompanySchema, companyAdminPasswordResetSchema } from './company.schema';
import { sendSuccess, sendError } from '../../../utils/response';

export class CompanyController {
    /**
     * POST /api/super-admin/companies
     *
     * Pipeline:
     *   authenticate  →  authorizeRoles('SUPER_ADMIN')  →  authorizePermissions('COMPANY_CREATE')
     *   →  this handler
     *
     * Creates a new Company and its initial COMPANY_ADMIN user inside a single
     * MongoDB transaction. Returns 201 Created on success.
     */
    static async create(req: AuthenticatedRequest, res: Response) {
        // ── Validation ────────────────────────────────────────────────────────
        const parsed = createCompanySchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        try {
            // ── Service call (transaction is handled inside) ───────────────────
            const actorUserId = req.user?.userId;
            const result = await CompanyService.createWithAdmin(parsed.data, actorUserId);

            return sendSuccess(
                res,
                'Company and admin user created successfully',
                result,
                201
            );
        } catch (error: any) {
            // Duplicate / conflict errors
            if (
                error.message?.includes('already exists') ||
                error.code === 11000
            ) {
                return sendError(res, error.message || 'Duplicate entry', 409);
            }

            return sendError(res, error.message || 'Failed to create company', 500);
        }
    }

    /**
     * GET /api/super-admin/getcompanies
     *
     * Returns all companies. Protected by SUPER_ADMIN role.
     */
    static async getAll(req: AuthenticatedRequest, res: Response) {
        try {
            const companies = await CompanyService.findAll();
            return sendSuccess(res, 'Companies fetched successfully', companies);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to fetch companies', 500);
        }
    }

    /**
     * GET /api/super-admin/companies/:id
     *
     * Returns a full company details payload including subscriptions and events. Protected by SUPER_ADMIN role.
     */
    static async getOne(req: AuthenticatedRequest, res: Response) {
        try {
            // Check for id or companyId to be safe, depending on route params
            const companyId = req.params.id || req.params.companyId;
            const fullDetails = await CompanyService.getFullDetails(companyId as string);
            return sendSuccess(res, 'Company details fetched successfully', fullDetails);
        } catch (error: any) {
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            return sendError(res, error.message || 'Failed to fetch company details', 500);
        }
    }

    /**
     * PATCH /api/super-admin/companies/:companyId
     * Edits company profile details.
     */
    static async edit(req: AuthenticatedRequest, res: Response) {
        const { companyId } = req.params as { companyId: string };
        const parsed = editCompanySchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        try {
            const company = await CompanyService.editCompany(companyId, parsed.data);
            return sendSuccess(res, 'Company updated successfully', { company });
        } catch (error: any) {
            if (error.message?.includes('already registered') || error.code === 11000) {
                return sendError(res, 'Email is already registered by another company', 409);
            }
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            return sendError(res, error.message || 'Failed to update company', 500);
        }
    }

    /**
     * PATCH /api/super-admin/companies/:companyId/suspend
     * Suspends a company.
     */
    static async suspend(req: AuthenticatedRequest, res: Response) {
        const { companyId } = req.params as { companyId: string };
        const parsed = suspendCompanySchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        try {
            const actorUserId = req.user?.userId || '';
            const company = await CompanyService.suspendCompany(companyId, parsed.data.reason, actorUserId);
            return sendSuccess(res, 'Company suspended successfully', { company });
        } catch (error: any) {
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            return sendError(res, error.message || 'Failed to suspend company', 500);
        }
    }

    /**
     * PATCH /api/super-admin/companies/:companyId/activate
     * Activates a suspended company.
     */
    static async activate(req: AuthenticatedRequest, res: Response) {
        const { companyId } = req.params as { companyId: string };
        try {
            const actorUserId = req.user?.userId || '';
            const company = await CompanyService.activateCompany(companyId, actorUserId);
            return sendSuccess(res, 'Company activated successfully', { company });
        } catch (error: any) {
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            return sendError(res, error.message || 'Failed to activate company', 500);
        }
    }

    /**
     * DELETE /api/super-admin/companies/:companyId
     * Soft deletes a company.
     */
    static async delete(req: AuthenticatedRequest, res: Response) {
        const { companyId } = req.params as { companyId: string };
        try {
            const actorUserId = req.user?.userId || '';
            await CompanyService.deleteCompany(companyId, actorUserId);
            return sendSuccess(res, 'Company deleted successfully', null);
        } catch (error: any) {
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            return sendError(res, error.message || 'Failed to delete company', 500);
        }
    }

    /**
     * POST /api/super-admin/companies/:companyId/admin/reset-password
     * Resets company admin password.
     */
    static async resetAdminPassword(req: AuthenticatedRequest, res: Response) {
        const { companyId } = req.params as { companyId: string };
        const parsed = companyAdminPasswordResetSchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        try {
            const actorUserId = req.user?.userId || '';
            await CompanyService.resetCompanyAdminPassword(companyId, parsed.data, actorUserId);
            return sendSuccess(res, 'Password reset initiated successfully', null);
        } catch (error: any) {
            if (error.message === 'Company not found') {
                return sendError(res, 'Company not found', 404);
            }
            if (error.message?.includes('not found') || error.message?.includes('Admin not found')) {
                return sendError(res, error.message, 404);
            }
            return sendError(res, error.message || 'Failed to reset password', 500);
        }
    }
}
