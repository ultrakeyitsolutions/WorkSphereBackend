import { Response } from 'express';
import { AuthenticatedRequest } from '../../types';
import { catchAsync } from '../../utils/catchAsync';
import { AppError } from '../../utils/AppError';
import { sendSuccess } from '../../utils/response';
import { StatusUpdateService } from './status-update.service';

export class StatusUpdateController {
    /**
     * POST /api/v1/status-updates (or /member/status-updates)
     * Member submits or updates today's daily work report
     */
    static submitStatusUpdate = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const employeeId = req.user?.userId;
        if (!companyId || !employeeId) throw AppError.unauthorized('Authentication context required.');

        const result = await StatusUpdateService.submitStatusUpdate(companyId, employeeId, req.body);
        sendSuccess(res, 'Status update submitted successfully.', result, 201);
    });

    /**
     * PUT /api/v1/status-updates/:id
     * Member updates their own status update
     */
    static updateStatusUpdate = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const employeeId = req.user?.userId;
        if (!companyId || !employeeId) throw AppError.unauthorized('Authentication context required.');

        const result = await StatusUpdateService.updateStatusUpdate(
            companyId,
            employeeId,
            req.params.id,
            req.body
        );
        sendSuccess(res, 'Status update updated successfully.', result, 200);
    });

    /**
     * GET /api/v1/status-updates/my-history
     * Member retrieves their own status update history
     */
    static getMemberHistory = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const employeeId = req.user?.userId;
        if (!companyId || !employeeId) throw AppError.unauthorized('Authentication context required.');

        const result = await StatusUpdateService.getMemberStatusUpdates(
            companyId,
            employeeId,
            req.query
        );
        sendSuccess(res, 'Member status updates retrieved successfully.', result, 200);
    });

    /**
     * GET /api/v1/status-updates/overview (or /company/status-updates/overview)
     * Company Admin retrieves statistical overview
     */
    static getCompanyOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Company context required.');

        const result = await StatusUpdateService.getCompanyStatusOverview(companyId, req.query);
        sendSuccess(res, 'Status updates overview retrieved successfully.', result, 200);
    });

    /**
     * GET /api/v1/status-updates/company (or /company/status-updates)
     * Company Admin retrieves paginated status updates across employees
     */
    static getCompanyStatusUpdates = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) throw AppError.unauthorized('Company context required.');

        const result = await StatusUpdateService.getCompanyStatusUpdates(companyId, req.query);
        sendSuccess(res, 'Company status updates retrieved successfully.', result, 200);
    });

    /**
     * GET /api/v1/status-updates/:id
     * Single status update lookup (Role-aware)
     */
    static getStatusUpdateById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const role = req.user?.role;
        if (!companyId || !userId) throw AppError.unauthorized('Authentication context required.');

        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'COMPANY_ADMIN';
        const result = await StatusUpdateService.getStatusUpdateById(
            companyId,
            userId,
            req.params.id,
            isAdmin
        );
        sendSuccess(res, 'Status update details retrieved successfully.', result, 200);
    });

    /**
     * POST /api/v1/status-updates/:id/feedback
     * Admin or Manager adds review feedback / comment
     */
    static addFeedback = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const authorId = req.user?.userId;
        const authorRole = req.user?.role || 'COMPANY_ADMIN';
        if (!companyId || !authorId) throw AppError.unauthorized('Authentication context required.');

        const result = await StatusUpdateService.addFeedback(
            companyId,
            authorId,
            authorRole,
            req.params.id,
            req.body.comment
        );
        sendSuccess(res, 'Feedback added successfully.', result, 201);
    });
}

