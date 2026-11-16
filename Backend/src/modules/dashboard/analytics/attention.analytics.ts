import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { Status } from '../../tasks/status.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveStatus } from '../../attendance/attendance.types';
import { TimesheetApproval } from '../../timesheet/timesheet-approval.model';
import { TimesheetApprovalStatus } from '../../timesheet/timesheet.types';
import { Release } from '../../releases/release.model';
import { ReleaseStatus } from '../../releases/release.types';
import { ProjectHealthService } from '../services/project-health.service';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';
import {
    ResolvedDateRange,
    CompanyAttentionData,
    AttentionTaskItem,
    AttentionProjectItem,
    AttentionLeaveItem,
    AttentionTimesheetItem,
    AttentionTrendBucket,
} from '../dashboard.types';

export class AttentionAnalytics {
    public static async getAttentionItems(
        companyId: Types.ObjectId,
        limit = 10,
        dateRange?: ResolvedDateRange,
        requestedInterval?: 'day' | 'week' | 'month',
        now = new Date()
    ): Promise<CompanyAttentionData> {
        const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const cappedLimit = Math.min(Math.max(limit, 1), 30);
        const resolvedRange = dateRange || DashboardDateRangeService.resolve({ period: 'last_7_days' });

        const daysCount = resolvedRange.days.length;
        let interval: 'day' | 'week' | 'month' = requestedInterval || 'day';
        if (!requestedInterval) {
            if (daysCount > 60) {
                interval = 'month';
            } else if (daysCount > 14) {
                interval = 'week';
            } else {
                interval = 'day';
            }
        }
        const buckets = this.buildBuckets(resolvedRange.startDate, resolvedRange.endDate, interval);

        // 1. Resolve statuses from the collection 'status'
        const allStatuses = await Status.find({
            $or: [{ companyId }, { companyId: null }, { companyId: { $exists: false } }],
        }).lean();

        const completedStatusIds = allStatuses
            .filter((s) => ['completed', 'done', 'closed', 'resolved'].includes((s.name || '').toLowerCase().trim()))
            .map((s) => s._id);

        const inReviewStatusIds = allStatuses
            .filter((s) => ['in review', 'in_review', 'under review', 'review', 'qa', 'testing'].includes((s.name || '').toLowerCase().trim()))
            .map((s) => s._id);

        const blockedStatusIds = allStatuses
            .filter((s) => ['blocked', 'on hold', 'on_hold'].includes((s.name || '').toLowerCase().trim()))
            .map((s) => s._id);

        // Base filter for active open tasks
        const activeOpenTaskMatch: any = {
            companyId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
            completedDate: null,
            statusId: { $nin: completedStatusIds },
        };

        const overdueDateFilter = {
            $or: [
                { dueDate: { $ne: null, $lt: now } },
                { dueDate: null, deliveryDate: { $ne: null, $lt: now } },
            ],
        };

        const upcomingDateFilter = {
            $or: [
                { dueDate: { $gte: now, $lte: threeDaysLater } },
                { dueDate: null, deliveryDate: { $gte: now, $lte: threeDaysLater } },
            ],
        };

        const [
            overdueCount,
            upcomingCount,
            overdueDocs,
            upcomingDocs,
            tasksInReviewDocs,
            blockedTasksDocs,
            overdueMilestonesDocs,
            projects,
            pendingLeaveCount,
            pendingLeavesDocs,
            pendingTimesheetCount,
            pendingTimesheetsDocs,
            trendTasks,
            trendLeaves,
            trendTimesheets,
        ] = await Promise.all([
            // 1. Overdue tasks count
            Task.countDocuments({
                ...activeOpenTaskMatch,
                ...overdueDateFilter,
            }),

            // 2. Upcoming deadlines count
            Task.countDocuments({
                ...activeOpenTaskMatch,
                ...upcomingDateFilter,
            }),

            // 3. Overdue task documents
            Task.find({
                ...activeOpenTaskMatch,
                ...overdueDateFilter,
            })
                .sort({ dueDate: 1, deliveryDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .populate<{ statusId: { _id: Types.ObjectId; name: string } }>('statusId', 'name')
                .lean(),

            // 4. Upcoming task documents
            Task.find({
                ...activeOpenTaskMatch,
                ...upcomingDateFilter,
            })
                .sort({ dueDate: 1, deliveryDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .populate<{ statusId: { _id: Types.ObjectId; name: string } }>('statusId', 'name')
                .lean(),

            // 5. Tasks awaiting review
            Task.find({
                companyId,
                isArchived: { $ne: true },
                isDeleted: { $ne: true },
                statusId: { $in: inReviewStatusIds },
            })
                .sort({ updatedAt: -1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .populate<{ statusId: { _id: Types.ObjectId; name: string } }>('statusId', 'name')
                .lean(),

            // 6. Blocked tasks
            Task.find({
                companyId,
                isArchived: { $ne: true },
                isDeleted: { $ne: true },
                statusId: { $in: blockedStatusIds },
            })
                .sort({ updatedAt: -1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .populate<{ statusId: { _id: Types.ObjectId; name: string } }>('statusId', 'name')
                .lean(),

            // 7. Overdue milestones from Release
            Release.find({
                companyId,
                status: { $nin: [ReleaseStatus.RELEASED, ReleaseStatus.CANCELLED] },
                targetDate: { $lt: now },
            })
                .sort({ targetDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            // 8. Active projects for health check
            Project.find({
                companyId,
                deletedAt: null,
                status: { $nin: [ProjectStatus.ARCHIVED, ProjectStatus.CANCELLED] },
            })
                .select('_id name status endDate startDate')
                .lean(),

            // 9. Pending leaves count
            LeaveRequest.countDocuments({
                companyId,
                status: LeaveStatus.PENDING,
            }),

            // 10. Pending leaves documents
            LeaveRequest.find({
                companyId,
                status: LeaveStatus.PENDING,
            })
                .sort({ startDate: 1 })
                .limit(cappedLimit)
                .populate<{ employeeId: { _id: Types.ObjectId; name: string } }>('employeeId', 'name')
                .lean(),

            // 11. Pending timesheets count
            TimesheetApproval.countDocuments({
                companyId,
                status: TimesheetApprovalStatus.SUBMITTED,
            }),

            // 12. Pending timesheets documents
            TimesheetApproval.find({
                companyId,
                status: TimesheetApprovalStatus.SUBMITTED,
            })
                .sort({ periodEnd: 1 })
                .limit(cappedLimit)
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .lean(),

            // 13. Tasks for trend calculations
            Task.find({
                companyId,
                isArchived: { $ne: true },
                isDeleted: { $ne: true },
                $or: [
                    { dueDate: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { deliveryDate: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { completedDate: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { dueDate: { $lt: resolvedRange.startDate }, completedDate: null },
                    { deliveryDate: { $lt: resolvedRange.startDate }, completedDate: null },
                ],
            })
                .select('_id dueDate deliveryDate completedDate statusId')
                .lean(),

            // 14. Leaves for trend
            LeaveRequest.find({
                companyId,
                $or: [
                    { appliedAt: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { startDate: { $gte: resolvedRange.startDateStr, $lte: resolvedRange.endDateStr } },
                    { status: LeaveStatus.PENDING },
                ],
            })
                .select('_id startDate appliedAt status')
                .lean(),

            // 15. Timesheets for trend
            TimesheetApproval.find({
                companyId,
                $or: [
                    { submittedAt: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { periodEnd: { $gte: resolvedRange.startDate, $lte: resolvedRange.endDate } },
                    { status: TimesheetApprovalStatus.SUBMITTED },
                ],
            })
                .select('_id periodEnd submittedAt status')
                .lean(),
        ]);

        // Transform Overdue Tasks
        const overdueTasks: AttentionTaskItem[] = overdueDocs.map((t: any) => {
            const due = t.dueDate ? new Date(t.dueDate) : t.deliveryDate ? new Date(t.deliveryDate) : now;
            const diffMs = now.getTime() - due.getTime();
            const daysOverdue = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

            return {
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                projectId: String(t.projectId?._id || t.projectId || ''),
                projectName: t.projectId?.name || 'Project',
                assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
                dueDate: due.toISOString(),
                daysOverdue,
                priority: t.priority || 'MEDIUM',
                status: t.statusId?.name || 'Open',
            };
        });

        // Transform Upcoming Deadlines
        const upcomingDeadlines: AttentionTaskItem[] = upcomingDocs.map((t: any) => {
            const due = t.dueDate ? new Date(t.dueDate) : t.deliveryDate ? new Date(t.deliveryDate) : now;
            return {
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                projectId: String(t.projectId?._id || t.projectId || ''),
                projectName: t.projectId?.name || 'Project',
                assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
                dueDate: due.toISOString(),
                priority: t.priority || 'MEDIUM',
                status: t.statusId?.name || 'In Progress',
            };
        });

        // Transform Tasks Awaiting Review
        const tasksInReview: AttentionTaskItem[] = tasksInReviewDocs.map((t: any) => {
            const due = t.dueDate ? new Date(t.dueDate) : t.deliveryDate ? new Date(t.deliveryDate) : now;
            return {
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                projectId: String(t.projectId?._id || t.projectId || ''),
                projectName: t.projectId?.name || 'Project',
                assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
                dueDate: due.toISOString(),
                priority: t.priority || 'MEDIUM',
                status: t.statusId?.name || 'In Review',
            };
        });

        // Transform Blocked Tasks
        const blockedTasks: AttentionTaskItem[] = blockedTasksDocs.map((t: any) => {
            const due = t.dueDate ? new Date(t.dueDate) : t.deliveryDate ? new Date(t.deliveryDate) : now;
            return {
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                projectId: String(t.projectId?._id || t.projectId || ''),
                projectName: t.projectId?.name || 'Project',
                assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
                dueDate: due.toISOString(),
                priority: t.priority || 'HIGH',
                status: t.statusId?.name || 'Blocked',
            };
        });

        // Transform Overdue Milestones
        const overdueMilestones = overdueMilestonesDocs.map((m: any) => {
            const target = m.targetDate ? new Date(m.targetDate) : now;
            const diffMs = now.getTime() - target.getTime();
            const daysOverdue = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            return {
                id: String(m._id),
                name: m.name,
                version: m.version,
                projectId: String(m.projectId?._id || m.projectId || ''),
                projectName: m.projectId?.name || 'Project',
                targetDate: target.toISOString(),
                daysOverdue,
                status: m.status,
            };
        });

        // Evaluate At-Risk Projects
        const projectIds = projects.map((p) => p._id);
        const taskStats = await Task.aggregate([
            {
                $match: {
                    companyId,
                    projectId: { $in: projectIds },
                    isArchived: { $ne: true },
                    isDeleted: { $ne: true },
                },
            },
            {
                $lookup: {
                    from: 'status',
                    localField: 'statusId',
                    foreignField: '_id',
                    as: 'statusDoc',
                },
            },
            {
                $project: {
                    projectId: 1,
                    statusName: { $toLower: { $ifNull: [{ $arrayElemAt: ['$statusDoc.name', 0] }, ''] } },
                    completedDate: 1,
                    effectiveDueDate: { $ifNull: ['$dueDate', '$deliveryDate'] },
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
                                        { $in: ['$statusName', ['completed', 'done', 'closed', 'resolved']] },
                                        { $and: [{ $ne: [{ $ifNull: ['$completedDate', null] }, null] }, { $ne: ['$completedDate', ''] }] },
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
                                        { $not: [{ $in: ['$statusName', ['completed', 'done', 'closed', 'resolved']] }] },
                                        { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
                                        { $ne: [{ $ifNull: ['$effectiveDueDate', null] }, null] },
                                        { $lt: ['$effectiveDueDate', now] },
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

        const pStatsMap = new Map<string, { total: number; completed: number; overdue: number }>();
        taskStats.forEach((s) =>
            pStatsMap.set(String(s._id), {
                total: s.total,
                completed: s.completed,
                overdue: s.overdue,
            })
        );

        const atRiskProjectsList: AttentionProjectItem[] = [];
        for (const proj of projects) {
            const pIdStr = String(proj._id);
            const stats = pStatsMap.get(pIdStr) || { total: 0, completed: 0, overdue: 0 };
            const progressPercentage = stats.total > 0
                ? Math.round((stats.completed / stats.total) * 10000) / 100
                : 0;

            const health = ProjectHealthService.evaluate(
                {
                    projectId: pIdStr,
                    projectName: proj.name,
                    endDate: proj.endDate,
                    totalTasks: stats.total,
                    completedTasks: stats.completed,
                    overdueTasks: stats.overdue,
                    progressPercentage,
                },
                now
            );

            if (health.status === 'delayed' || health.status === 'at_risk') {
                atRiskProjectsList.push({
                    id: pIdStr,
                    name: proj.name,
                    healthStatus: health.status,
                    progressPercentage,
                    endDate: proj.endDate ? new Date(proj.endDate).toISOString() : new Date().toISOString(),
                    reasons: health.reasons,
                });
            }
        }

        atRiskProjectsList.sort(
            (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        );
        const atRiskCount = atRiskProjectsList.length;
        const cappedAtRisk = atRiskProjectsList.slice(0, cappedLimit);

        // Transform Pending Leaves
        const pendingLeaves: AttentionLeaveItem[] = pendingLeavesDocs.map((l: any) => ({
            id: String(l._id),
            employeeId: String(l.employeeId?._id || l.employeeId),
            employeeName: l.employeeId?.name || 'Employee',
            leaveType: l.leaveType,
            startDate: l.startDate,
            endDate: l.endDate,
            totalDays: l.totalDays,
            reason: l.reason,
            appliedAt: l.appliedAt ? new Date(l.appliedAt).toISOString() : new Date().toISOString(),
        }));

        // Transform Pending Timesheets
        const pendingTimesheets: AttentionTimesheetItem[] = pendingTimesheetsDocs.map((t: any) => ({
            id: String(t._id),
            userId: String(t.userId?._id || t.userId),
            userName: t.userId?.name || 'Employee',
            periodStart: new Date(t.periodStart).toISOString(),
            periodEnd: new Date(t.periodEnd).toISOString(),
            submittedAt: t.submittedAt ? new Date(t.submittedAt).toISOString() : undefined,
        }));

        // Bin items into time buckets based on ACTUAL records
        for (const bucket of buckets) {
            const bStart = new Date(bucket.periodStart).getTime();
            const bEnd = new Date(bucket.periodEnd).getTime();

            // Overdue tasks active or due before this bucket end
            bucket.overdue = (trendTasks as any[]).filter((t) => {
                const dueVal = t.dueDate || t.deliveryDate;
                const due = dueVal ? new Date(dueVal).getTime() : 0;
                const comp = t.completedDate ? new Date(t.completedDate).getTime() : null;
                return due > 0 && due <= bEnd && (!comp || comp > bEnd);
            }).length;

            // Deadlines falling inside this bucket
            bucket.deadlines = (trendTasks as any[]).filter((t) => {
                const dueVal = t.dueDate || t.deliveryDate;
                const due = dueVal ? new Date(dueVal).getTime() : 0;
                return due >= bStart && due <= bEnd;
            }).length;

            // Pending leaves + timesheets active or submitted in this bucket
            const leavesInBucket = (trendLeaves as any[]).filter((l) => {
                const app = l.appliedAt ? new Date(l.appliedAt).getTime() : 0;
                return app >= bStart && app <= bEnd;
            }).length;

            const timesheetsInBucket = (trendTimesheets as any[]).filter((ts) => {
                const sub = ts.submittedAt ? new Date(ts.submittedAt).getTime() : 0;
                return sub >= bStart && sub <= bEnd;
            }).length;

            bucket.pending = leavesInBucket + timesheetsInBucket;
            bucket.total = bucket.overdue + bucket.deadlines + bucket.pending;
        }

        const currentActiveTotal = overdueCount + upcomingCount + pendingLeaveCount + pendingTimesheetCount + atRiskCount;
        const totalAttention = buckets.reduce((acc, b) => acc + b.total, 0) || currentActiveTotal;

        const mid = Math.floor(buckets.length / 2);
        const firstHalf = buckets.slice(0, mid).reduce((acc, b) => acc + b.total, 0);
        const secondHalf = buckets.slice(mid).reduce((acc, b) => acc + b.total, 0);
        const changeResult = firstHalf > 0
            ? DashboardDateRangeService.calculatePercentageChange(secondHalf, firstHalf)
            : { percentageChange: secondHalf > 0 ? 0 : 0, trend: 'FLAT' as const };
        const percentageChange = changeResult.percentageChange ?? 0;

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: resolvedRange.timezone,
                period: resolvedRange.period,
                startDate: resolvedRange.startDateStr,
                endDate: resolvedRange.endDateStr,
                interval,
            },
            counts: {
                overdueTasks: overdueCount,
                upcomingDeadlines: upcomingCount,
                atRiskProjects: atRiskCount,
                pendingLeaves: pendingLeaveCount,
                pendingTimesheets: pendingTimesheetCount,
                tasksInReview: tasksInReviewDocs.length,
                blockedTasks: blockedTasksDocs.length,
                overdueMilestones: overdueMilestonesDocs.length,
            },
            summary: {
                totalAttention,
                percentageChange,
            },
            trends: buckets,
            overdueTasks,
            upcomingDeadlines,
            tasksInReview,
            blockedTasks,
            overdueMilestones,
            atRiskProjects: cappedAtRisk,
            pendingLeaves,
            pendingTimesheets,
        };
    }

    private static buildBuckets(
        startDate: Date,
        endDate: Date,
        interval: 'day' | 'week' | 'month'
    ): AttentionTrendBucket[] {
        const buckets: AttentionTrendBucket[] = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        if (interval === 'day') {
            const cursor = new Date(startDate);
            cursor.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            while (cursor <= end) {
                const bStart = new Date(cursor);
                bStart.setHours(0, 0, 0, 0);
                const bEnd = new Date(cursor);
                bEnd.setHours(23, 59, 59, 999);

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}-${String(bStart.getDate()).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]} ${String(bStart.getDate()).padStart(2, '0')}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    overdue: 0,
                    deadlines: 0,
                    pending: 0,
                    total: 0,
                });

                cursor.setDate(cursor.getDate() + 1);
            }
        } else if (interval === 'week') {
            const cursor = new Date(startDate);
            cursor.setHours(0, 0, 0, 0);

            while (cursor <= endDate) {
                const bStart = new Date(cursor);
                bStart.setHours(0, 0, 0, 0);
                const bEnd = new Date(cursor);
                bEnd.setDate(bEnd.getDate() + 6);
                bEnd.setHours(23, 59, 59, 999);
                if (bEnd > endDate) {
                    bEnd.setTime(endDate.getTime());
                }

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}-${String(bStart.getDate()).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]} ${bStart.getDate()} - ${monthNames[bEnd.getMonth()]} ${bEnd.getDate()}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    overdue: 0,
                    deadlines: 0,
                    pending: 0,
                    total: 0,
                });

                cursor.setDate(cursor.getDate() + 7);
            }
        } else {
            // Month interval
            const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1, 0, 0, 0, 0);

            while (cursor <= endDate) {
                const bStart = new Date(cursor);
                const bEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);

                const dateStr = `${bStart.getFullYear()}-${String(bStart.getMonth() + 1).padStart(2, '0')}`;
                const label = `${monthNames[bStart.getMonth()]}`;

                buckets.push({
                    date: dateStr,
                    label,
                    periodStart: bStart.toISOString(),
                    periodEnd: bEnd.toISOString(),
                    overdue: 0,
                    deadlines: 0,
                    pending: 0,
                    total: 0,
                });

                cursor.setMonth(cursor.getMonth() + 1);
            }
        }

        return buckets;
    }
}
