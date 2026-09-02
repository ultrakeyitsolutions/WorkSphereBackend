import { Response } from 'express';
import { AuthenticatedRequest } from '../../../modules/auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { MemberService } from './member.service';
import { sendSuccess } from '../../../utils/response';

export const getClients = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const result = await MemberService.getMembers({
        companyId,
        memberType: 'CLIENT',
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        search: req.query.search as string,
        status: req.query.status as string,
        roleId: req.query.roleId as string,
        designationId: req.query.designationId as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc'
    });

    res.status(200).send({
        success: true,
        message: 'Clients fetched successfully',
        ...result
    });
});

export const getClientById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const member = await MemberService.getMemberById(companyId, memberId as string);
    return sendSuccess(res, 'Client fetched', member);
});

export const updateClient = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const updated = await MemberService.updateMember(companyId, memberId as string, req.body);
    return sendSuccess(res, 'Client updated', updated);
});

export const deleteClient = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const result = await MemberService.deleteMember(companyId, memberId as string);
    return sendSuccess(res, 'Client deleted', result);
});
