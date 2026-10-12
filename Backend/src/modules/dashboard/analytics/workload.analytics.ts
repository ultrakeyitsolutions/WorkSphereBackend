import { Types } from 'mongoose';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import {
    ResolvedDateRange,
    CompanyWorkloadData,
    MemberWorkloadItem,
} from '../dashboard.types';

export class WorkloadAnalytics {
    public static async getWorkload(
        companyId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        departmentId?: Types.ObjectId,
        filterProjectId?: Types.ObjectId,
        page = 1,
        limit = 10,
        now = new Date()
    ): Promise<CompanyWorkloadData> {
        // 1. Fetch active company members
        const memberQuery: any = {
            companyId,
            status: 'ACTIVE',
            memberType: { $in: ['EMPLOYEE', 'MANAGER'] },
        };
        if (departmentId) {
            memberQuery.designationId = departmentId;
        }

        const members = await CompanyMember.find(memberQuery)
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; isActive: boolean; status: string } }>(
                'userId',
                'name email isActive status'
            )
            .populate<{ designationId: { _id: Types.ObjectId; name: string } }>(
                'designationId',
                'name'
            )
            .lean();

        // Filter for active users only
        const activeMembers = members.filter(
            (m) => m.userId && m.userId.isActive && m.userId.status !== 'DEACTIVATED'
        );

        if (activeMembers.length === 0) {
            return {
                meta: {
                    period: dateRange.period,
                    startDate: dateRange.startDateStr,
                    endDate: dateRange.endDateStr,
                    timezone: dateRange.timezone,
                    generatedAt: now.toISOString(),
                    scope: 'COMPANY',
                    isCompanyWide: true,
                },
                summary: {
                    totalMembers: 0,
                    underCapacity: 0,
                    balanced: 0,
                    overloaded: 0,
                },
                members: [],
                pagination: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0,
                },
            };
        }

        const userIds = activeMembers.map((m) => m.userId._id);

        const taskMatch: any = {
            companyId,
            assignedToId: { $in: userIds },
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };
        if (filterProjectId) {
            taskMatch.projectId = filterProjectId;
        }

        // 2. Parallel aggregations for tasks & tracked time
        const [incompleteTaskStats, periodCompletedStats, timeStats] = await Promise.all([
            // Incomplete & Overdue tasks
            Task.aggregate([
                {
                    $match: {
                        ...taskMatch,
                        completedDate: null,
                    },
                },
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
                    $match: {
                        'statusDoc.name': { $not: /completed|done|closed|cancelled/i },
                    },
                },
                {
                    $group: {
                        _id: '$assignedToId',
                        openTasks: { $sum: 1 },
                        overdueTasks: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: [{ $ifNull: ['$dueDate', null] }, null] },
                                            { $lt: ['$dueDate', now] },
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

            // Period completed tasks
            Task.aggregate([
                {
                    $match: {
                        ...taskMatch,
                        completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                    },
                },
                {
                    $group: {
                        _id: '$assignedToId',
                        completedTasks: { $sum: 1 },
                    },
                },
            ]),

            // Tracked seconds in period
            TimeTracking.aggregate([
                {
                    $match: {
                        companyId,
                        userId: { $in: userIds },
                        startedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                        ...(filterProjectId ? { projectId: filterProjectId } : {}),
                    },
                },
                {
                    $group: {
                        _id: '$userId',
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
            ]),
        ]);

        const openMap = new Map<string, { open: number; overdue: number }>();
        incompleteTaskStats.forEach((s) =>
            openMap.set(String(s._id), { open: s.openTasks, overdue: s.overdueTasks })
        );

        const compMap = new Map<string, number>();
        periodCompletedStats.forEach((s) => compMap.set(String(s._id), s.completedTasks));

        const timeMap = new Map<string, number>();
        timeStats.forEach((s) => timeMap.set(String(s._id), s.totalSeconds));

        // 3. Assemble member workload cards
        const workloadItems: MemberWorkloadItem[] = activeMembers.map((m) => {
            const uIdStr = String(m.userId._id);
            const openInfo = openMap.get(uIdStr) || { open: 0, overdue: 0 };
            const completed = compMap.get(uIdStr) || 0;
            const trackedSeconds = timeMap.get(uIdStr) || 0;
            const trackedHours = Math.round((trackedSeconds / 3600) * 100) / 100;

            let workloadStatus: 'under_capacity' | 'balanced' | 'overloaded' = 'under_capacity';
            if (openInfo.open > 10 || openInfo.overdue > 3) {
                workloadStatus = 'overloaded';
            } else if (openInfo.open >= 3 && openInfo.overdue <= 1) {
                workloadStatus = 'balanced';
            }

            return {
                userId: uIdStr,
                name: m.userId.name,
                email: m.userId.email,
                designation: m.designationId?.name || 'Team Member',
                memberType: m.memberType,
                assignedTasks: openInfo.open + completed,
                openTasks: openInfo.open,
                completedTasks: completed,
                overdueTasks: openInfo.overdue,
                trackedHours,
                workloadStatus,
            };
        });

        // 4. Calculate summary categories
        let underCapacity = 0;
        let balanced = 0;
        let overloaded = 0;

        for (const item of workloadItems) {
            if (item.workloadStatus === 'overloaded') overloaded++;
            else if (item.workloadStatus === 'balanced') balanced++;
            else underCapacity++;
        }

        // 5. Paginate
        const total = workloadItems.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedMembers = workloadItems.slice(startIndex, startIndex + limit);

        return {
            meta: {
                period: dateRange.period,
                startDate: dateRange.startDateStr,
                endDate: dateRange.endDateStr,
                timezone: dateRange.timezone,
                generatedAt: now.toISOString(),
                scope: 'COMPANY',
                isCompanyWide: true,
            },
            summary: {
                totalMembers: total,
                underCapacity,
                balanced,
                overloaded,
            },
            members: paginatedMembers,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        };
    }
}
