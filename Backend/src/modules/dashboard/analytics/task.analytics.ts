import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { DashboardScopeContext, TaskAnalyticsResponse, TaskTrendItem } from '../dashboard.types';

export class TaskAnalytics {
    public static async getTaskAnalytics(context: DashboardScopeContext, now = new Date()): Promise<TaskAnalyticsResponse> {
        const { companyId, userId, isCompanyWide, accessibleProjectIds, filterProjectId, filterTeamId, dateRange } = context;

        const match: any = {
            companyId,
            isArchived: { $ne: true },
        };

        if (filterProjectId) {
            match.projectId = filterProjectId;
        } else if (!isCompanyWide) {
            match.projectId = { $in: accessibleProjectIds };
        }

        if (!isCompanyWide) {
            match.assignedToId = userId;
        } else if (filterTeamId) {
            match.assignedToId = filterTeamId;
        }

        const [countsResult, createdTrendResult, completedTrendResult] = await Promise.all([
            Task.aggregate([
                { $match: match },
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
                        _id: null,
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
                        inProgress: {
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
                        onHold: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
                                            { $regexMatch: { input: { $ifNull: ['$statusDoc.name', ''] }, regex: /hold|paused|blocked/i } },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        overdue: {
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

            // Trend: Created tasks
            Task.aggregate([
                {
                    $match: {
                        ...match,
                        ...(dateRange.startDate && dateRange.endDate ? { createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate } } : {}),
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 },
                    },
                },
            ]),

            // Trend: Completed tasks
            Task.aggregate([
                {
                    $match: {
                        ...match,
                        completedDate: {
                            $ne: null,
                            ...(dateRange.startDate && dateRange.endDate ? { $gte: dateRange.startDate, $lte: dateRange.endDate } : {}),
                        },
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedDate' } },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const counts = countsResult[0] || {
            total: 0,
            completed: 0,
            inProgress: 0,
            onHold: 0,
            overdue: 0,
        };

        const pending = Math.max(0, counts.total - counts.completed - counts.inProgress - counts.onHold);
        const completionPercentage = counts.total > 0
            ? Math.round((counts.completed / counts.total) * 10000) / 100
            : 0;

        const createdMap = new Map<string, number>();
        createdTrendResult.forEach((c) => createdMap.set(c._id, c.count));

        const completedMap = new Map<string, number>();
        completedTrendResult.forEach((c) => completedMap.set(c._id, c.count));

        const days = dateRange.days && dateRange.days.length > 0
            ? dateRange.days
            : [now.toISOString().split('T')[0]];

        const trend: TaskTrendItem[] = days.map((dateStr) => ({
            date: dateStr,
            created: createdMap.get(dateStr) || 0,
            completed: completedMap.get(dateStr) || 0,
        }));

        return {
            total: counts.total,
            completed: counts.completed,
            inProgress: counts.inProgress,
            pending,
            overdue: counts.overdue,
            onHold: counts.onHold,
            completionPercentage,
            trend,
        };
    }
}
