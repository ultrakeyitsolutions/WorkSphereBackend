import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { StorageConfigurationService } from './storage-config.service';
import { sendSuccess, sendError } from '../../../utils/response';

export class StorageConfigController {
    /**
     * GET /api/super-admin/storage/configuration
     */
    static async getConfiguration(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const config = await StorageConfigurationService.getActiveConfiguration();
            const safeConfig = StorageConfigurationService.toSafeResponse(config);
            return sendSuccess(res, 'Storage configuration retrieved successfully', safeConfig);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve storage configuration', 500);
        }
    }

    /**
     * PUT /api/super-admin/storage/configuration
     */
    static async updateConfiguration(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const updated = await StorageConfigurationService.updateConfiguration(userId, req.body);
            return sendSuccess(res, 'Storage configuration updated successfully', updated);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to update storage configuration', 400);
        }
    }

    /**
     * POST /api/super-admin/storage/test
     */
    static async testConfiguration(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const { provider, configuration } = req.body;
            const result = await StorageConfigurationService.testConfiguration(provider, configuration);

            if (!result.success) {
                return sendError(res, result.message, 400, result);
            }

            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Storage connection test failed', 500);
        }
    }

    /**
     * GET /api/super-admin/storage/health
     */
    static async getHealth(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const health = await StorageConfigurationService.getHealth();
            const statusCode = health.status === 'HEALTHY' ? 200 : 503;
            return sendSuccess(res, 'Storage health status retrieved', health, statusCode);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to check storage health', 500);
        }
    }

    /**
     * GET /api/super-admin/storage/history
     */
    static async getHistory(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const limit = parseInt(req.query.limit as string, 10) || 20;
            const history = await StorageConfigurationService.getHistory(limit);
            return sendSuccess(res, 'Storage configuration history retrieved', history);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve storage history', 500);
        }
    }

    /**
     * POST /api/super-admin/storage/rollback/:historyId
     */
    static async rollback(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const userId = req.user?.userId;
            const historyId = req.params.historyId as string;
            if (!userId) {
                return sendError(res, 'Unauthorized context', 401);
            }

            const rolledBack = await StorageConfigurationService.rollback(userId, historyId);
            return sendSuccess(res, 'Storage configuration rolled back successfully', rolledBack);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to rollback storage configuration', 400);
        }
    }
}
export default StorageConfigController;
