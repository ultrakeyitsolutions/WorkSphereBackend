import { Types } from 'mongoose';
import { Project } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { DashboardScopeContext, SprintAnalyticsItem } from '../dashboard.types';

export class SprintAnalytics {
    public static async getSprintAnalytics(context: DashboardScopeContext, now = new Date()): Promise<SprintAnalyticsItem[]> {
        const { companyId, accessibleProjectIds, isCompanyWide, userId, filterProjectId } = context;

        if (accessibleProjectIds.length === 0) {
            return [];
        }

        const targetProjectIds = filterProjectId
            ? accessibleProjectIds.filter((id) => id.equals(filterProjectId))
            : accessibleProjectIds;

        if (targetProjectIds.length === 0) {
            return [];
        }

        const projects = await Project.find({
            _id: { $in: targetProjectIds },
            companyId,
            deletedAt: null,
            isActive: true,
        })
            .sort({ isPinned: -1, createdAt: -1 })
            .limit(5)
            .lean();

        if (projects.length === 0) {
            return [];
        }

        const projectIds = projects.map((p) => p._id);

        const taskMatch: any = {
            companyId,
            projectId: { $in: projectIds },
            isArchived: { $ne: true },
        };

        if (!isCompanyWide) {
            taskMatch.assignedToId = userId;
        }

        const taskStats = await Task.aggregate([
            { $match: taskMatch },
            {
                $lookup: {
                    from: 'statuses',
                    localField: 'statusId',
                    foreignField: '_id',
                    as: 'statusDoc',
                },
            },
            {
                $unwind: {
                    path: '$statusDoc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $group: {
                    _id: '$projectId',
                    total: { $sum: 1 },
                    completed: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $gt: ['$completedDate', null] },
                                        { $regexMatch: { input: { $ifNull: ['$statusDoc.name', ''] }, regex: /completed|done|closed/i } },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]);

        const statsMap = new Map<string, { total: number; completed: number }>();
        taskStats.forEach((s) => statsMap.set(String(s._id), { total: s.total, completed: s.completed }));

        return projects.map((proj) => {
            const pIdStr = String(proj._id);
            const stats = statsMap.get(pIdStr) || { total: 0, completed: 0 };
            const progressPercentage = stats.total > 0
                ? Math.round((stats.completed / stats.total) * 10000) / 100
                : 0;

            const endDate = proj.endDate ? new Date(proj.endDate) : now;
            const diffMs = endDate.getTime() - now.getTime();
            const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

            return {
                sprintId: pIdStr,
                name: `${proj.name} Milestone`,
                projectId: pIdStr,
                projectName: proj.name,
                totalTasks: stats.total,
                completedTasks: stats.completed,
                progressPercentage,
                startDate: proj.startDate ? new Date(proj.startDate).toISOString() : now.toISOString(),
                endDate: endDate.toISOString(),
                daysRemaining,
            };
        });
    }
}
