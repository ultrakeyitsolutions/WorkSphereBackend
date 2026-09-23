import { Project, ProjectTeamMember } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { DashboardScopeContext, ProjectAnalyticsItem } from '../dashboard.types';

export class ProjectAnalytics {
    public static async getProjectAnalytics(context: DashboardScopeContext, now = new Date()): Promise<ProjectAnalyticsItem[]> {
        const { companyId, accessibleProjectIds, isCompanyWide, userId, dateRange, filterProjectId } = context;

        if (accessibleProjectIds.length === 0) {
            return [];
        }

        // 1. Build Project Match Filter
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
        })
            .select('_id name status priority startDate endDate')
            .lean();

        if (projects.length === 0) {
            return [];
        }

        const projectIds = projects.map((p) => p._id);

        // 2. Parallel Aggregations: Tasks, Member Counts, and Logged Minutes
        const taskMatch: any = {
            companyId,
            projectId: { $in: projectIds },
            isArchived: { $ne: true },
        };

        const trackingMatch: any = {
            companyId,
            projectId: { $in: projectIds },
        };

        if (dateRange.startDate && dateRange.endDate) {
            trackingMatch.startedAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        // If employee scope: lock task & tracking metrics to the authenticated employee
        if (!isCompanyWide) {
            taskMatch.assignedToId = userId;
            trackingMatch.userId = userId;
        }

        const [taskStats, memberCounts, trackingStats] = await Promise.all([
            Task.aggregate([
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
                        totalTasks: { $sum: 1 },
                        completedTasks: {
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
                        inProgressTasks: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
                                            { $regexMatch: { input: { $ifNull: ['$statusDoc.name', ''] }, regex: /progress|working|active/i } },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        overdueTasks: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
                                            { $ne: [{ $ifNull: ['$dueDate', null] }, null] },
                                            { $lt: ['$dueDate', now] },
                                            {
                                                $not: {
                                                    $regexMatch: {
                                                        input: { $ifNull: ['$statusDoc.name', ''] },
                                                        regex: /completed|done|closed|cancelled/i,
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ]),

            isCompanyWide
                ? ProjectTeamMember.aggregate([
                    { $match: { projectId: { $in: projectIds } } },
                    { $group: { _id: '$projectId', memberCount: { $sum: 1 } } },
                ])
                : Promise.resolve([]),

            TimeTracking.aggregate([
                { $match: trackingMatch },
                {
                    $group: {
                        _id: '$projectId',
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
            ]),
        ]);

        const taskMap = new Map<string, any>();
        taskStats.forEach((t) => taskMap.set(String(t._id), t));

        const memberMap = new Map<string, number>();
        memberCounts.forEach((m: any) => memberMap.set(String(m._id), m.memberCount));

        const trackingMap = new Map<string, number>();
        trackingStats.forEach((tr) => trackingMap.set(String(tr._id), Math.round((tr.totalSeconds || 0) / 60)));

        return projects.map((proj) => {
            const pIdStr = String(proj._id);
            const t = taskMap.get(pIdStr) || { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, overdueTasks: 0 };
            const pendingTasks = Math.max(0, t.totalTasks - t.completedTasks - t.inProgressTasks);
            const progressPercentage = t.totalTasks > 0
                ? Math.round((t.completedTasks / t.totalTasks) * 10000) / 100
                : 0;
            const loggedMinutes = trackingMap.get(pIdStr) || 0;

            if (!isCompanyWide) {
                return {
                    projectId: pIdStr,
                    projectName: proj.name,
                    status: proj.status || 'ACTIVE',
                    totalTasks: t.totalTasks,
                    completedTasks: t.completedTasks,
                    pendingTasks,
                    inProgressTasks: t.inProgressTasks,
                    overdueTasks: t.overdueTasks,
                    progressPercentage,
                    loggedMinutes,
                    myTasks: t.totalTasks,
                    myCompletedTasks: t.completedTasks,
                    myPendingTasks: pendingTasks,
                    myOverdueTasks: t.overdueTasks,
                    myLoggedMinutes: loggedMinutes,
                    myProgressPercentage: progressPercentage,
                };
            }

            return {
                projectId: pIdStr,
                projectName: proj.name,
                status: proj.status || 'ACTIVE',
                totalTasks: t.totalTasks,
                completedTasks: t.completedTasks,
                pendingTasks,
                inProgressTasks: t.inProgressTasks,
                overdueTasks: t.overdueTasks,
                progressPercentage,
                memberCount: memberMap.get(pIdStr) || 0,
                loggedMinutes,
            };
        });
    }
}
