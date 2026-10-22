import { Request, Response } from 'express';
import { AccountRecoveryService } from './account-recovery.service';
import {
    createRecoveryRequestSchema,
    completeRecoverySchema,
    getRecoveryStatusSchema,
    approveRecoverySchema,
    rejectRecoverySchema,
    listRecoveryRequestsQuerySchema,
} from './account-recovery.validator';
import { AuthenticatedRequest } from '../auth.types';
import { sendSuccess, sendError } from '../../../utils/response';
import { catchAsync } from '../../../utils/catchAsync';
import { AppError } from '../../../utils/AppError';

export class AccountRecoveryController {
    /**
     * POST /api/v1/public/account-recovery-requests
     * Public submission of account recovery request
     */
    static createRequest = catchAsync(async (req: Request, res: Response) => {
        const parsed = createRecoveryRequestSchema.safeParse({ body: req.body });
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const result = await AccountRecoveryService.createRequest(parsed.data.body.email, req);
        return sendSuccess(res, result.message, result, 200);
    });

    /**
     * POST /api/v1/public/account-recovery-requests/:requestId/complete
     * Public completion of recovery verification and account restoration
     */
    static completeRecovery = catchAsync(async (req: Request, res: Response) => {
        const parsed = completeRecoverySchema.safeParse({
            params: req.params,
            body: req.body,
        });

        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const result = await AccountRecoveryService.completeRecovery(
            parsed.data.params.requestId,
            parsed.data.body.token,
            req
        );

        return sendSuccess(res, result.message, result, 200);
    });

    /**
     * GET /api/v1/public/account-recovery-requests/:requestId/status
     * Public minimal status query
     */
    static getStatus = catchAsync(async (req: Request, res: Response) => {
        const parsed = getRecoveryStatusSchema.safeParse({ params: req.params });
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const result = await AccountRecoveryService.getStatus(parsed.data.params.requestId);
        return sendSuccess(res, 'Recovery status retrieved', result, 200);
    });

    /**
     * GET /api/v1/superadmin/account-recovery-requests
     * SuperAdmin: List and search recovery requests
     */
    static listRequests = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const parsed = listRecoveryRequestsQuerySchema.safeParse({ query: req.query });
        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const result = await AccountRecoveryService.listRequests(parsed.data.query);
        return sendSuccess(res, 'Account recovery requests fetched successfully', result, 200);
    });

    /**
     * GET /api/v1/superadmin/account-recovery-requests/:requestId
     * SuperAdmin: View detailed request information
     */
    static getRequestById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const requestId = req.params.requestId as string;
        if (!requestId) {
            throw AppError.badRequest('Request ID parameter is required');
        }

        const result = await AccountRecoveryService.getRequestById(requestId);
        return sendSuccess(res, 'Account recovery request details retrieved', result, 200);
    });

    /**
     * POST /api/v1/superadmin/account-recovery-requests/:requestId/approve
     * SuperAdmin: Approve recovery request
     */
    static approveRequest = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const parsed = approveRecoverySchema.safeParse({
            params: req.params,
            body: req.body,
        });

        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const adminId = (req.authenticatedUser?.userId || req.user?.userId) as string;
        const adminEmail = (req.authenticatedUser?.email || req.user?.email) as string;

        if (!adminId) {
            throw AppError.unauthorized('Administrator identity context missing');
        }

        const result = await AccountRecoveryService.approveRequest(
            parsed.data.params.requestId,
            adminId,
            adminEmail,
            parsed.data.body.adminReason,
            req
        );

        return sendSuccess(res, result.message, result, 200);
    });

    /**
     * POST /api/v1/superadmin/account-recovery-requests/:requestId/reject
     * SuperAdmin: Reject recovery request
     */
    static rejectRequest = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const parsed = rejectRecoverySchema.safeParse({
            params: req.params,
            body: req.body,
        });

        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        const adminId = (req.authenticatedUser?.userId || req.user?.userId) as string;
        const adminEmail = (req.authenticatedUser?.email || req.user?.email) as string;

        if (!adminId) {
            throw AppError.unauthorized('Administrator identity context missing');
        }

        const result = await AccountRecoveryService.rejectRequest(
            parsed.data.params.requestId,
            adminId,
            adminEmail,
            parsed.data.body.adminReason,
            req
        );

        return sendSuccess(res, result.message, result, 200);
    });
}
