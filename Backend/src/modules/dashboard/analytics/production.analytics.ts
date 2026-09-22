import { Types } from 'mongoose';
import { ProjectAnalyticsItem, ProductionByProjectItem, DashboardScopeContext } from '../dashboard.types';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';

export class ProductionAnalytics {
    public static async getProductionByProject(
        context: DashboardScopeContext,
        projectAnalytics: ProjectAnalyticsItem[]
    ): Promise<ProductionByProjectItem[]> {
        const { companyId, isCompanyWide, userId, dateRange } = context;

        if (projectAnalytics.length === 0) {
            return [];
        }

        const projectIds = projectAnalytics.map((p) => new Types.ObjectId(p.projectId));

        const trackingMatch: any = {
            companyId,
            projectId: { $in: projectIds },
        };

        const activityMatch: any = {
            companyId,
            projectId: { $in: projectIds },
        };

        if (dateRange.startDate && dateRange.endDate) {
            trackingMatch.startedAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
            activityMatch.createdAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        if (!isCompanyWide) {
            trackingMatch.userId = userId;
            activityMatch.userId = userId;
        }

        const [activeUsersPerProject, activitiesPerProject] = await Promise.all([
            isCompanyWide
                ? TimeTracking.aggregate([
                    { $match: trackingMatch },
                    { $group: { _id: { projectId: '$projectId', userId: '$userId' } } },
                    { $group: { _id: '$_id.projectId', activeUsers: { $sum: 1 } } },
                ])
                : Promise.resolve([]),
            TaskActivity.aggregate([
                { $match: activityMatch },
                { $group: { _id: '$projectId', activityCount: { $sum: 1 } } },
            ]),
        ]);

        const activeUsersMap = new Map<string, number>();
        activeUsersPerProject.forEach((u: any) => activeUsersMap.set(String(u._id), u.activeUsers));

        const activityMap = new Map<string, number>();
        activitiesPerProject.forEach((a) => activityMap.set(String(a._id), a.activityCount));

        return projectAnalytics.map((p) => {
            const activeUsers = isCompanyWide
                ? activeUsersMap.get(p.projectId) || (p.loggedMinutes > 0 ? 1 : 0)
                : 1;
            const taskActivityCount = activityMap.get(p.projectId) || 0;

            return {
                projectId: p.projectId,
                projectName: p.projectName,
                completedTasks: p.completedTasks,
                loggedMinutes: p.loggedMinutes,
                activeUsers,
                completionPercentage: p.progressPercentage,
                taskActivityCount,
            };
        });
    }
}
