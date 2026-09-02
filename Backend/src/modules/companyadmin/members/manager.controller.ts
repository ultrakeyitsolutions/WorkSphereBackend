import { Response } from 'express';
import { AuthenticatedRequest } from '../../../modules/auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { MemberService } from './member.service';
import { sendSuccess } from '../../../utils/response';

export const getManagers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const result = await MemberService.getMembers({
        companyId,
        memberType: 'MANAGER',
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
        message: 'Managers fetched successfully',
        ...result
    });
});

export const getManagerById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const member = await MemberService.getMemberById(companyId, memberId as string);
    return sendSuccess(res, 'Manager fetched', member);
});

export const updateManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const updated = await MemberService.updateMember(companyId, memberId as string, req.body);
    return sendSuccess(res, 'Manager updated', updated);
});

export const deleteManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;

    const result = await MemberService.deleteMember(companyId, memberId as string);
    return sendSuccess(res, 'Manager deleted', result);
});
