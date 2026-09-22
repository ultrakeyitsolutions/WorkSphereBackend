import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { DashboardService } from './dashboard.service';

export const getDashboard = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user;
    if (!user) {
        throw AppError.unauthorized('User context not found');
    }

    const impersonatedCompanyId = user.role === 'SUPER_ADMIN'
        ? (req.query.companyId as string) || (req.headers['x-company-id'] as string)
        : undefined;

    const query = req.query as any;
    const data = await DashboardService.getDashboardData(user, query, impersonatedCompanyId);

    return sendSuccess(res, 'Dashboard analytics retrieved successfully', data);
});
