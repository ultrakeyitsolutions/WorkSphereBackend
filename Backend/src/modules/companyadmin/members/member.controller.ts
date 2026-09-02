import { Response } from 'express';
import { AuthenticatedRequest } from '../../../modules/auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { MemberService } from './member.service';
import { sendSuccess } from '../../../utils/response';

export const updateMemberStatus = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;
    const { status } = req.body;

    const result = await MemberService.updateMemberStatus(companyId, memberId as string, status);
    return sendSuccess(res, 'Member status updated', result);
});

export const updateMemberBiometric = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId as string;
    const { memberId } = req.params;
    const { biometricId } = req.body;

    const result = await MemberService.updateMember(companyId, memberId as string, { biometricId });
    return sendSuccess(res, 'Member biometric updated', result);
});
