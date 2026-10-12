import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { MemberOverviewAnalytics } from '../analytics/member-overview.analytics';
import { MemberTrendsAnalytics } from '../analytics/member-trends.analytics';
import { MemberWorkAnalytics } from '../analytics/member-work.analytics';
import { MemberDashboardService } from '../../companyadmin/members/member-dashboard.service';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';
import { Company } from '../../super-admin/companies/company.model';
import { User } from '../../users/user.model';

export class MemberDashboardController {
    private static async resolveMemberContext(req: AuthenticatedRequest) {
        const companyIdStr = req.user?.companyId;
        const userIdStr = req.user?.userId;

        if (!companyIdStr || !Types.ObjectId.isValid(companyIdStr)) {
            throw AppError.unauthorized('Unauthorized: Company context required');
        }
        if (!userIdStr || !Types.ObjectId.isValid(userIdStr)) {
            throw AppError.unauthorized('Unauthorized: User identity context required');
        }

        const companyId = new Types.ObjectId(companyIdStr);
        const userId = new Types.ObjectId(userIdStr);

        const [companyDoc, userDoc] = await Promise.all([
            Company.findById(companyId).select('timezone').lean(),
            User.findById(userId).select('timezone').lean(),
        ]);

        const companyTimezone = companyDoc?.timezone || null;
        const userTimezone = (userDoc as any)?.timezone || null;

        return { companyId, userId, companyTimezone, userTimezone };
    }

    public static getOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, companyTimezone, userTimezone } =
            await MemberDashboardController.resolveMemberContext(req);
        const query = req.query as any;

        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone, userTimezone);
        const data = await MemberOverviewAnalytics.getOverview(companyId, userId, dateRange);

        return sendSuccess(res, 'Member dashboard overview retrieved successfully', data);
    });

    public static getWorkTrends = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId, companyTimezone, userTimezone } =
            await MemberDashboardController.resolveMemberContext(req);
        const query = req.query as any;

        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone, userTimezone);
        const interval = query.interval as ('day' | 'week') | undefined;

        const data = await MemberTrendsAnalytics.getTrends(companyId, userId, dateRange, interval);
        return sendSuccess(res, 'Member work trends retrieved successfully', data);
    });

    public static getMyWork = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId } = await MemberDashboardController.resolveMemberContext(req);
        const query = req.query as any;

        const limit = Math.min(Math.max(1, Number(query.limit) || 10), 50);
        const data = await MemberWorkAnalytics.getMyWork(companyId, userId, limit);

        return sendSuccess(res, 'Member work retrieved successfully', data);
    });

    // Backwards-compatible legacy stats endpoint
    public static getStats = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, userId } = await MemberDashboardController.resolveMemberContext(req);
        const stats = await MemberDashboardService.getStats(String(companyId), String(userId));
        return sendSuccess(res, 'Dashboard stats retrieved successfully', stats);
    });
}
