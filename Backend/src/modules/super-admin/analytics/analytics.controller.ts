import { Request, Response } from 'express';
import { SuperAdminAnalyticsService } from './analytics.service';
import { parseDateRange } from '../shared/date-range.util';
import { sendSuccess, sendError } from '../../../utils/response';

export class SuperAdminAnalyticsController {
    public static async getUserGrowth(req: Request, res: Response): Promise<Response> {
        try {
            const dateRange = parseDateRange(req);
            const data = await SuperAdminAnalyticsService.getUserGrowth(dateRange);
            return sendSuccess(res, 'User growth analytics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get user growth analytics', 500);
        }
    }

    public static async getCompanyGrowth(req: Request, res: Response): Promise<Response> {
        try {
            const dateRange = parseDateRange(req);
            const data = await SuperAdminAnalyticsService.getCompanyGrowth(dateRange);
            return sendSuccess(res, 'Company growth analytics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get company growth analytics', 500);
        }
    }

    public static async getProjectsSummary(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminAnalyticsService.getProjectsSummary();
            return sendSuccess(res, 'Projects summary analytics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get projects summary analytics', 500);
        }
    }

    public static async getWorkforceAnalytics(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminAnalyticsService.getWorkforceAnalytics();
            return sendSuccess(res, 'Workforce analytics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get workforce analytics', 500);
        }
    }

    public static async getPlatformUsage(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminAnalyticsService.getPlatformUsage();
            return sendSuccess(res, 'Platform usage analytics retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get platform usage analytics', 500);
        }
    }
}
