import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { MemberDashboardService } from './member-dashboard.service';

export const getMemberDashboardStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) throw AppError.unauthorized('Unauthorized: Missing user context');

    const stats = await MemberDashboardService.getStats(companyId, userId);
    return sendSuccess(res, 'Dashboard stats retrieved successfully', stats);
});
