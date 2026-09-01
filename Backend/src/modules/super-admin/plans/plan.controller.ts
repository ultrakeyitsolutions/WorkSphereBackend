import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { PlanService } from './plans.service';
import { createPlanSchema, updatePlanSchema } from './plans.schema';
import { sendSuccess, sendError } from '../../../utils/response';

// ── POST /api/super-admin/plans ───────────────────────────────────────────────
export const createPlan = async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 'Validation Error', 400, parsed.error.format());
    }
    try {
        const plan = await PlanService.createPlan(parsed.data);
        return sendSuccess(res, 'Plan created successfully', plan, 201);
    } catch (error: any) {
        if (error.message?.includes('already exists')) return sendError(res, error.message, 409);
        if (error.message?.includes('do not exist') || error.message?.includes('Inactive')) {
            return sendError(res, error.message, 422);
        }
        if (error.message?.includes('BOOLEAN') || error.message?.includes('LIMIT')) {
            return sendError(res, error.message, 422);
        }
        return sendError(res, error.message || 'Failed to create plan', 500);
    }
};

// ── GET /api/super-admin/plans ────────────────────────────────────────────────
export const getAllPlans = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const includeArchived = req.query.includeArchived === 'true';
        const plans = await PlanService.getAllPlans(includeArchived);
        return sendSuccess(res, 'Plans fetched successfully', plans);
    } catch (error: any) {
        return sendError(res, error.message || 'Failed to fetch plans', 500);
    }
};

// ── GET /api/super-admin/plans/:id ────────────────────────────────────────────
export const getPlanById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const plan = await PlanService.getPlanById(id);
        if (!plan) return sendError(res, 'Plan not found', 404);
        return sendSuccess(res, 'Plan fetched successfully', plan);
    } catch (error: any) {
        return sendError(res, error.message || 'Failed to fetch plan', 500);
    }
};

// ── PATCH /api/super-admin/plans/:id ─────────────────────────────────────────
export const updatePlan = async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 'Validation Error', 400, parsed.error.format());
    }
    try {
        const { id } = req.params as { id: string };
        const plan = await PlanService.updatePlan(id, parsed.data);
        return sendSuccess(res, 'Plan updated successfully', plan);
    } catch (error: any) {
        if (error.message === 'Plan not found') return sendError(res, 'Plan not found', 404);
        if (error.message?.includes('Archived')) return sendError(res, error.message, 409);
        if (error.message?.includes('BOOLEAN') || error.message?.includes('LIMIT') ||
            error.message?.includes('do not exist') || error.message?.includes('Inactive')) {
            return sendError(res, error.message, 422);
        }
        return sendError(res, error.message || 'Failed to update plan', 500);
    }
};

// ── PATCH /api/super-admin/plans/:id/status ──────────────────────────────────
export const changePlanStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return sendError(res, 'isActive must be a boolean', 400);
        }

        const plan = await PlanService.changePlanStatus(id, isActive);
        return sendSuccess(res, 'Plan status updated successfully', plan);
    } catch (error: any) {
        if (error.message === 'Plan not found') return sendError(res, 'Plan not found', 404);
        return sendError(res, error.message || 'Failed to update plan status', 500);
    }
};
