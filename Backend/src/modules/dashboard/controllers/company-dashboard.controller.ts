import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { CompanyOverviewAnalytics } from '../analytics/company-overview.analytics';
import { DeliveryTrendsAnalytics } from '../analytics/delivery-trends.analytics';
import { ProjectHealthAnalytics } from '../analytics/project-health-analytics';
import { WorkloadAnalytics } from '../analytics/workload.analytics';
import { AttentionAnalytics } from '../analytics/attention.analytics';
import { MilestonesAnalytics } from '../analytics/milestones.analytics';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';
import { Company } from '../../super-admin/companies/company.model';

export class CompanyDashboardController {
    private static async resolveCompanyContext(req: AuthenticatedRequest) {
        const companyIdStr = req.user?.companyId;
        if (!companyIdStr || !Types.ObjectId.isValid(companyIdStr)) {
            throw AppError.unauthorized('Unauthorized: Company context required');
        }

        const companyId = new Types.ObjectId(companyIdStr);
        const companyDoc = await Company.findById(companyId).select('timezone').lean();
        const companyTimezone = companyDoc?.timezone || null;

        return { companyId, companyTimezone };
    }

    public static getOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, companyTimezone } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone);
        const filterProjectId = query.projectId ? new Types.ObjectId(query.projectId) : undefined;

        const data = await CompanyOverviewAnalytics.getOverview(companyId, dateRange, filterProjectId);
        return sendSuccess(res, 'Company overview retrieved successfully', data);
    });

    public static getDeliveryTrends = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, companyTimezone } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone);
        const filterProjectId = query.projectId ? new Types.ObjectId(query.projectId) : undefined;
        const interval = query.interval as ('day' | 'week' | 'month') | undefined;

        const data = await DeliveryTrendsAnalytics.getTrends(companyId, dateRange, interval, filterProjectId);
        return sendSuccess(res, 'Delivery trends retrieved successfully', data);
    });

    public static getProjectHealth = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(Math.max(1, Number(query.limit) || 20), 100);
        const status = query.status as any;
        const filterProjectId = query.projectId && query.projectId !== 'all' && Types.ObjectId.isValid(query.projectId)
            ? new Types.ObjectId(query.projectId)
            : undefined;

        const data = await ProjectHealthAnalytics.getHealth(companyId, status, page, limit, filterProjectId);
        return sendSuccess(res, 'Project health retrieved successfully', data);
    });

    public static getWorkload = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId, companyTimezone } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone);
        const departmentId = query.departmentId ? new Types.ObjectId(query.departmentId) : undefined;
        const projectId = query.projectId ? new Types.ObjectId(query.projectId) : undefined;
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(Math.max(1, Number(query.limit) || 10), 50);

        const data = await WorkloadAnalytics.getWorkload(
            companyId,
            dateRange,
            departmentId,
            projectId,
            page,
            limit
        );
        return sendSuccess(res, 'Team workload retrieved successfully', data);
    });

    public static getAttention = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const limit = Math.min(Math.max(1, Number(query.limit) || 10), 30);
        const data = await AttentionAnalytics.getAttentionItems(companyId, limit);
        return sendSuccess(res, 'Attention items retrieved successfully', data);
    });

    public static getMilestones = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { companyId } = await CompanyDashboardController.resolveCompanyContext(req);
        const query = req.query as any;

        const projectId = query.projectId ? new Types.ObjectId(query.projectId) : undefined;
        const status = query.status as string | undefined;
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(Math.max(1, Number(query.limit) || 10), 50);

        const data = await MilestonesAnalytics.getMilestones(companyId, projectId, status, page, limit);
        return sendSuccess(res, 'Milestones retrieved successfully', data);
    });
}
