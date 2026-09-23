import { Request, Response } from 'express';
import { DashboardSubscriptionsService } from './dashboard-subscriptions.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class DashboardSubscriptionsController {
    public static async getSummary(req: Request, res: Response): Promise<Response> {
        try {
            const summary = await DashboardSubscriptionsService.getSummary();
            return sendSuccess(res, 'Subscriptions summary retrieved successfully', summary);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get subscriptions summary', statusCode);
        }
    }

    public static async listSubscriptions(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                plan: req.query.plan as string,
                status: req.query.status as string,
            };

            const result = await DashboardSubscriptionsService.listSubscriptions(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Subscriptions retrieved successfully',
                data: {
                    subscriptions: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to list subscriptions', statusCode);
        }
    }

    public static async getCompanySubscription(req: Request, res: Response): Promise<Response> {
        try {
            const companyId = String(req.params.companyId);
            const data = await DashboardSubscriptionsService.getCompanySubscription(companyId);
            return sendSuccess(res, 'Company subscription retrieved successfully', data);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get company subscription', statusCode);
        }
    }
}
