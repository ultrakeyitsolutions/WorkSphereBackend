import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerDashboardService } from '../services/manager-dashboard.service';

export const getDashboard = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerDashboardService.getDashboardOverview(scope, req.query as any);
    return sendSuccess(res, 'Manager dashboard overview retrieved successfully', result);
});
