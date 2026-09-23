import { Request, Response } from 'express';
import { SuperAdminSecurityService } from './security.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';

export class SuperAdminSecurityController {
    public static async getSummary(req: Request, res: Response): Promise<Response> {
        try {
            const data = await SuperAdminSecurityService.getSummary();
            return sendSuccess(res, 'Security summary retrieved successfully', data);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get security summary', 500);
        }
    }

    public static async listSessions(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                userId: req.query.userId as string,
                search: req.query.search as string,
            };

            const result = await SuperAdminSecurityService.listSessions(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Sessions retrieved successfully',
                data: {
                    sessions: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to list sessions', 500);
        }
    }

    public static async listEvents(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                action: req.query.action as string,
                userId: req.query.userId as string,
                search: req.query.search as string,
            };

            const result = await SuperAdminSecurityService.listEvents(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Security events retrieved successfully',
                data: {
                    events: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to list security events', 500);
        }
    }
}
