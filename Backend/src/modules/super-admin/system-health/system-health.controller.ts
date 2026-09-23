import { Request, Response } from 'express';
import { SuperAdminSystemHealthService } from './system-health.service';
import { sendSuccess, sendError } from '../../../utils/response';

export class SuperAdminSystemHealthController {
    public static async getHealth(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminSystemHealthService.getHealth();
            return sendSuccess(res, 'System health retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve system health', 500);
        }
    }

    public static async getMetrics(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminSystemHealthService.getMetrics();
            return sendSuccess(res, 'System metrics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve system metrics', 500);
        }
    }
}
