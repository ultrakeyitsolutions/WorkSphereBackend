import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { sendSuccess, sendError } from '../../../utils/response';
import { InvitationService } from './invitation.service';
import { validateData } from '../../../middleware/validateRequest';
import {
    inviteMembersSchema,
    acceptInvitationSchema,
    registerViaInvitationSchema,
    validateTokenQuerySchema,
} from './invitation.validator';

export class InvitationController {

    /**
     * POST /api/v1/company/invitations  — Bulk invite (auth required)
     */
    static async inviteMembers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(inviteMembersSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const companyId = (req.user as any)?.companyId as string | undefined;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);
            if (!userId) return sendError(res, 'User context not found in token', 401);

            const result = await InvitationService.invite(
                parsed.data.members,
                companyId,
                userId
            );

            const statusCode = result.failed > 0 && result.created === 0 ? 422 : 207;
            return res.status(statusCode).json({ success: true, message: 'Invitation batch processed', data: result });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/company/invitations  — List (auth required)
     */
    static async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const invitations = await InvitationService.listByCompany(companyId);
            return sendSuccess(res, 'Invitations fetched successfully', invitations);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/invitations/validate?token=xxx  — Public
     */
    static async validateToken(req: Request, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(validateTokenQuerySchema, req.query);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const result = await InvitationService.validateToken(parsed.data.token);
            return sendSuccess(res, 'Invitation is valid', result.data);
        } catch (err: any) {
            if (err?.message) return sendError(res, err.message, 400);
            next(err);
        }
    }

    /**
     * POST /api/v1/invitations/accept  — Public: existing user accepts
     */
    static async accept(req: Request, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(acceptInvitationSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const result = await InvitationService.acceptInvitation(parsed.data);
            return sendSuccess(res, 'Invitation accepted successfully', result, 200);
        } catch (err: any) {
            if (err?.message) return sendError(res, err.message, 400);
            next(err);
        }
    }

    /**
     * POST /api/v1/invitations/register  — Public: new user registers & accepts
     */
    static async register(req: Request, res: Response, next: NextFunction) {
        try {
            const parsed = validateData(registerViaInvitationSchema, req.body);
            if (!parsed.success) return sendError(res, 'Validation error', 422, parsed.errors);

            const result = await InvitationService.registerViaInvitation(parsed.data);
            return sendSuccess(res, 'Account created and invitation accepted', result, 201);
        } catch (err: any) {
            if (err?.message) return sendError(res, err.message, 400);
            next(err);
        }
    }

    /**
     * POST /api/v1/company/invitations/:invitationId/resend
     */
    static async resend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            const userId = req.user?.userId;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);
            if (!userId) return sendError(res, 'User context not found in token', 401);

            const { invitationId } = req.params;
            const result = await InvitationService.resendInvitation(companyId, invitationId as string, userId);

            return sendSuccess(res, result.message, result, 200);
        } catch (err: any) {
            next(err);
        }
    }

    /**
     * POST /api/v1/company/invitations/:invitationId/cancel
     */
    static async cancel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = (req.user as any)?.companyId as string | undefined;
            if (!companyId) return sendError(res, 'Company context not found in token', 403);

            const { invitationId } = req.params;
            const result = await InvitationService.cancelInvitation(companyId, invitationId as string);

            return sendSuccess(res, result.message, result, 200);
        } catch (err: any) {
            next(err);
        }
    }
}
