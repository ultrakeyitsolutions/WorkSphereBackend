import { Request, Response } from 'express';
import { SuperAdminAuditService } from './audit.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class SuperAdminAuditController {
    public static async listLogs(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                actorUserId: req.query.actorUserId as string,
                targetUserId: req.query.targetUserId as string,
                companyId: req.query.companyId as string,
                action: req.query.action as string,
                module: req.query.module as string,
                startDate: req.query.startDate as string,
                endDate: req.query.endDate as string,
            };

            const result = await SuperAdminAuditService.listLogs(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Audit logs retrieved successfully',
                data: {
                    logs: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to list audit logs', statusCode);
        }
    }

    public static async getLogById(req: Request, res: Response): Promise<Response> {
        try {
            const auditId = String(req.params.auditId);
            const log = await SuperAdminAuditService.getLogById(auditId);
            return sendSuccess(res, 'Audit log details retrieved successfully', log);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get audit log details', statusCode);
        }
    }
}
