import { Request, Response } from 'express';
import { AuditLogService } from './audit-log.service';
import { sendSuccess, sendError } from '../../utils/response';
import { AuthenticatedRequest } from '../auth/auth.types';

export class AuditLogController {
    /**
     * GET /api/super-admin/audit-logs
     * Returns paginated audit logs with optional filters.
     *
     * Query params:
     *  - action       : AuditAction enum value
     *  - actorEmail   : partial match
     *  - companyId    : exact ObjectId
     *  - success      : 'true' | 'false'
     *  - startDate    : ISO date string
     *  - endDate      : ISO date string
     *  - page         : number (default 1)
     *  - limit        : number (default 50, max 200)
     */
    static async getAll(req: AuthenticatedRequest, res: Response) {
        try {
            const { action, actorEmail, companyId, success, startDate, endDate, page, limit } = req.query as Record<string, string>;

            const result = await AuditLogService.getAll({
                action,
                actorEmail,
                companyId,
                success,
                startDate,
                endDate,
                page: page ? parseInt(page, 10) : 1,
                limit: limit ? parseInt(limit, 10) : 50,
            });

            return sendSuccess(res, 'Audit logs retrieved successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve audit logs', 500);
        }
    }

    /**
     * GET /api/super-admin/audit-logs/stats
     * Returns quick aggregated stats for the dashboard.
     */
    static async getStats(_req: Request, res: Response) {
        try {
            const stats = await AuditLogService.getStats();
            return sendSuccess(res, 'Audit log statistics retrieved', stats);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve stats', 500);
        }
    }

    /**
     * GET /api/super-admin/audit-logs/:id
     * Fetch a single audit log entry.
     */
    static async getOne(req: Request, res: Response) {
        try {
            const log = await AuditLogService.getById(String(req.params.id));
            if (!log) {
                return sendError(res, 'Audit log entry not found', 404);
            }
            return sendSuccess(res, 'Audit log entry retrieved', log);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve audit log entry', 500);
        }
    }

    /**
     * GET /api/super-admin/audit-logs/company/:companyId
     * Fetch audit logs scoped to a specific company.
     *
     * Query params: action, success, startDate, endDate, page, limit
     */
    static async getByCompany(req: Request, res: Response) {
        try {
            const companyId = String(req.params.companyId);
            const { action, success, startDate, endDate, page, limit } = req.query as Record<string, string>;

            const result = await AuditLogService.getByCompany(companyId, {
                action,
                success,
                startDate,
                endDate,
                page: page ? parseInt(page, 10) : 1,
                limit: limit ? parseInt(limit, 10) : 50,
            });

            return sendSuccess(res, `Audit logs for company retrieved`, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve company audit logs', 500);
        }
    }
}
