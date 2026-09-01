import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { FeatureService } from './features.service';
import { createFeatureSchema, updateFeatureSchema } from './features.schema';
import { sendSuccess, sendError } from '../../../utils/response';

// ── POST /api/super-admin/features ───────────────────────────────────────────
export const createFeature = async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createFeatureSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 'Validation Error', 400, parsed.error.format());
    }
    try {
        const feature = await FeatureService.createFeature(parsed.data);
        return sendSuccess(res, 'Feature created successfully', feature, 201);
    } catch (error: any) {
        if (error.message?.includes('already exists')) return sendError(res, error.message, 409);
        return sendError(res, error.message || 'Failed to create feature', 500);
    }
};

// ── GET /api/super-admin/features ────────────────────────────────────────────
// ?activeOnly=true → returns only active features (used by plan creation UI)
export const getAllFeatures = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const activeOnly = req.query.activeOnly === 'true';
        const features = await FeatureService.getAllFeatures(activeOnly);
        return sendSuccess(res, 'Features fetched successfully', features);
    } catch (error: any) {
        return sendError(res, error.message || 'Failed to fetch features', 500);
    }
};

// ── GET /api/super-admin/features/:id ────────────────────────────────────────
export const getFeatureById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const feature = await FeatureService.getFeatureById(id);
        if (!feature) return sendError(res, 'Feature not found', 404);
        return sendSuccess(res, 'Feature fetched successfully', feature);
    } catch (error: any) {
        return sendError(res, error.message || 'Failed to fetch feature', 500);
    }
};

// ── PATCH /api/super-admin/features/:id ──────────────────────────────────────
export const updateFeature = async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateFeatureSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 'Validation Error', 400, parsed.error.format());
    }
    try {
        const { id } = req.params as { id: string };
        const feature = await FeatureService.updateFeature(id, parsed.data);
        return sendSuccess(res, 'Feature updated successfully', feature);
    } catch (error: any) {
        if (error.message === 'Feature not found') return sendError(res, 'Feature not found', 404);
        if (error.message?.includes('FEATURE_IN_USE')) return sendError(res, error.message, 409);
        return sendError(res, error.message || 'Failed to update feature', 500);
    }
};

// ── PATCH /api/super-admin/features/:id/status ───────────────────────────────
export const changeFeatureStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return sendError(res, 'isActive must be a boolean', 400);
        }

        const feature = await FeatureService.changeFeatureStatus(id, isActive);
        return sendSuccess(res, 'Feature status updated successfully', feature);
    } catch (error: any) {
        if (error.message === 'Feature not found') return sendError(res, 'Feature not found', 404);
        return sendError(res, error.message || 'Failed to update feature status', 500);
    }
};

// ── DELETE /api/super-admin/features/:id ─────────────────────────────────────
export const deleteFeature = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        await FeatureService.deleteFeature(id);
        return sendSuccess(res, 'Feature deleted successfully', null);
    } catch (error: any) {
        if (error.message === 'Feature not found') return sendError(res, 'Feature not found', 404);
        if (error.message?.includes('FEATURE_IN_USE')) return sendError(res, error.message, 409);
        return sendError(res, error.message || 'Failed to delete feature', 500);
    }
};
