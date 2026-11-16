import { Types } from 'mongoose';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Attendance } from '../../attendance/attendance.model';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { ResolvedDateRange, CompanyDashboardOverviewData } from '../dashboard.types';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';

export class CompanyOverviewAnalytics {
    public static async getOverview(
        companyId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        filterProjectId?: Types.ObjectId,
        now = new Date()
    ): Promise<CompanyDashboardOverviewData> {
        const projectMatch: any = {
            companyId,
            deletedAt: null,
            status: { $ne: ProjectStatus.ARCHIVED },
        };
        if (filterProjectId) {
            projectMatch._id = filterProjectId;
        }

        const taskMatch: any = {
            companyId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };
        if (filterProjectId) {
            taskMatch.projectId = filterProjectId;
        }

        const prevStartDate = dateRange.previousStartDate || dateRange.startDate;
        const prevEndDate = dateRange.previousEndDate || dateRange.endDate;

        const [
            projectStats,
            periodProjectStats,
            prevPeriodProjectStats,
            allTimeTaskStats,
            periodCompletedTasks,
            periodCreatedTasks,
            periodDueTasks,
            periodRelevantTasks,
            taskStatusDistributionRaw,
            periodTimeTracking,
            periodAttendance,
            prevCompletedTasks,
            prevCreatedTasks,
            prevTimeTracking,
            prevAttendance,
            activeMembersRaw,
            unassignedTasksCount,
        ] = await Promise.all([
            // 1. All-time projects snapshot
            Project.aggregate([
                { $match: projectMatch },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        active: {
                            $sum: { $cond: [{ $eq: ['$status', ProjectStatus.ACTIVE] }, 1, 0] },
                        },
                        completed: {
                            $sum: { $cond: [{ $eq: ['$status', ProjectStatus.COMPLETED] }, 1, 0] },
                        },
                        onHold: {
                            $sum: { $cond: [{ $eq: ['$status', ProjectStatus.ON_HOLD] }, 1, 0] },
                        },
                        delayed: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$status', ProjectStatus.COMPLETED] },
                                            { $ne: ['$status', ProjectStatus.CANCELLED] },
                                            { $lt: ['$endDate', now] },
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

            // 2. Period projects (due & completed in period)
            Project.aggregate([
                { $match: projectMatch },
                {
                    $group: {
                        _id: null,
                        dueInPeriod: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $gte: ['$endDate', dateRange.startDate] },
                                            { $lte: ['$endDate', dateRange.endDate] },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        completedInPeriod: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ['$status', ProjectStatus.COMPLETED] },
                                            {
                                                $or: [
                                                    {
                                                        $and: [
                                                            { $gte: ['$actualEndDate', dateRange.startDate] },
                                                            { $lte: ['$actualEndDate', dateRange.endDate] },
                                                        ],
                                                    },
                                                    {
                                                        $and: [
                                                            { $eq: [{ $ifNull: ['$actualEndDate', null] }, null] },
                                                            { $gte: ['$updatedAt', dateRange.startDate] },
                                                            { $lte: ['$updatedAt', dateRange.endDate] },
                                                        ],
                                                    },
                                                ],
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

            // 3. Previous period projects completed
            Project.countDocuments({
                ...projectMatch,
                status: ProjectStatus.COMPLETED,
                $or: [
                    { actualEndDate: { $gte: prevStartDate, $lte: prevEndDate } },
                    { actualEndDate: null, updatedAt: { $gte: prevStartDate, $lte: prevEndDate } },
                ],
            }),

            // 4. All-time tasks snapshot (using 'status' collection)
            Task.aggregate([
                { $match: taskMatch },
                {
                    $lookup: {
                        from: 'status',
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
                                            {
                                                $regexMatch: {
                                                    input: { $ifNull: ['$statusDoc.name', ''] },
                                                    regex: /completed|done|closed/i,
                                                },
                                            },
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
                                            {
                                                $regexMatch: {
                                                    input: { $ifNull: ['$statusDoc.name', ''] },
                                                    regex: /in[- ]?progress|doing|ongoing|active/i,
                                                },
                                            },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        cancelled: {
                            $sum: {
                                $cond: [
                                    {
                                        $regexMatch: {
                                            input: { $ifNull: ['$statusDoc.name', ''] },
                                            regex: /cancel|reject/i,
                                        },
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
                                                        regex: /completed|done|closed|cancel|reject/i,
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

            // 5. Period completed tasks
            Task.countDocuments({
                ...taskMatch,
                completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 6. Period created tasks
            Task.countDocuments({
                ...taskMatch,
                createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 7. Period due tasks
            Task.countDocuments({
                ...taskMatch,
                dueDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 8. Period relevant tasks
            Task.countDocuments({
                ...taskMatch,
                $or: [
                    { completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                    { dueDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                    { createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                ],
            }),

            // 9. Task status distribution
            Task.aggregate([
                { $match: taskMatch },
                {
                    $lookup: {
                        from: 'status',
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
                        _id: { $ifNull: ['$statusDoc.name', 'Unassigned'] },
                        color: { $first: { $ifNull: ['$statusDoc.color', '#6B7280'] } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
            ]),

            // 10. Period tracked seconds (TimeTracking)
            TimeTracking.aggregate([
                {
                    $match: {
                        companyId,
                        startedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                        ...(filterProjectId ? { projectId: filterProjectId } : {}),
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
            ]),

            // 11. Period attendance worked minutes
            Attendance.aggregate([
                {
                    $match: {
                        companyId,
                        'actual.firstCheckIn': { $gte: dateRange.startDate, $lte: dateRange.endDate },
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalMinutes: { $sum: '$actual.workedMinutes' },
                    },
                },
            ]),

            // 12. Previous period completed tasks
            Task.countDocuments({
                ...taskMatch,
                completedDate: { $gte: prevStartDate, $lte: prevEndDate },
            }),

            // 13. Previous period created tasks
            Task.countDocuments({
                ...taskMatch,
                createdAt: { $gte: prevStartDate, $lte: prevEndDate },
            }),

            // 14. Previous period tracked seconds
            TimeTracking.aggregate([
                {
                    $match: {
                        companyId,
                        startedAt: { $gte: prevStartDate, $lte: prevEndDate },
                        ...(filterProjectId ? { projectId: filterProjectId } : {}),
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
            ]),

            // 15. Previous period attendance minutes
            Attendance.aggregate([
                {
                    $match: {
                        companyId,
                        'actual.firstCheckIn': { $gte: prevStartDate, $lte: prevEndDate },
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalMinutes: { $sum: '$actual.workedMinutes' },
                    },
                },
            ]),

            // 16. Active company members for workload summary
            CompanyMember.find({
                companyId,
                status: 'ACTIVE',
                memberType: { $in: ['EMPLOYEE', 'MANAGER'] },
            })
                .populate<{ userId: { _id: Types.ObjectId; isActive: boolean; status: string } }>(
                    'userId',
                    '_id isActive status'
                )
                .lean(),

            // 17. Unassigned open tasks
            Task.countDocuments({
                ...taskMatch,
                assignedToId: null,
                completedDate: null,
            }),
        ]);

        // ── Process Project Metrics ──────────────────────────────────────────
        const proj = projectStats[0] || { total: 0, active: 0, completed: 0, onHold: 0, delayed: 0 };
        const periodProj = periodProjectStats[0] || { dueInPeriod: 0, completedInPeriod: 0 };

        const lifetimeDeliveryRate = proj.total > 0
            ? Math.round((proj.completed / proj.total) * 10000) / 100
            : 0;

        const periodDeliveryRate = periodProj.dueInPeriod > 0
            ? Math.round((periodProj.completedInPeriod / periodProj.dueInPeriod) * 10000) / 100
            : (periodProj.completedInPeriod > 0 ? 100 : null);

        // Standard deliveryRate: if projects are due in this period, use period rate; otherwise lifetime rate
        const displayDeliveryRate = periodProj.dueInPeriod > 0 && periodDeliveryRate !== null
            ? periodDeliveryRate
            : lifetimeDeliveryRate;

        // ── Process Task Metrics ─────────────────────────────────────────────
        const tasksAllTime = allTimeTaskStats[0] || { total: 0, completed: 0, inProgress: 0, cancelled: 0, overdue: 0 };
        const openTasks = Math.max(0, tasksAllTime.total - tasksAllTime.completed - tasksAllTime.cancelled);
        const pendingTasks = Math.max(0, openTasks - tasksAllTime.inProgress);
        const overduePercentage = openTasks > 0
            ? Math.round((tasksAllTime.overdue / openTasks) * 10000) / 100
            : 0;
        const taskCompletionRate = tasksAllTime.total > 0
            ? Math.round((tasksAllTime.completed / tasksAllTime.total) * 10000) / 100
            : 0;

        const periodCompletionRate = periodRelevantTasks > 0
            ? Math.round((periodCompletedTasks / periodRelevantTasks) * 10000) / 100
            : (periodCreatedTasks > 0 ? Math.round((periodCompletedTasks / periodCreatedTasks) * 10000) / 100 : null);

        // Status distribution items
        const totalStatusTasks = tasksAllTime.total || 1;
        const statusDistribution = taskStatusDistributionRaw.map((s) => ({
            status: s._id,
            count: s.count,
            percentage: Math.round((s.count / totalStatusTasks) * 100),
            color: s.color,
        }));

        // ── Process Tracked Hours & Attendance ──────────────────────────────
        const currentTrackedHours = periodTimeTracking[0]?.totalSeconds
            ? Math.round((periodTimeTracking[0].totalSeconds / 3600) * 100) / 100
            : 0;

        const currentAttendanceHours = periodAttendance[0]?.totalMinutes
            ? Math.round((periodAttendance[0].totalMinutes / 60) * 100) / 100
            : 0;

        const prevTrackedHours = prevTimeTracking[0]?.totalSeconds
            ? Math.round((prevTimeTracking[0].totalSeconds / 3600) * 100) / 100
            : 0;

        const prevAttendanceHours = prevAttendance[0]?.totalMinutes
            ? Math.round((prevAttendance[0].totalMinutes / 60) * 100) / 100
            : 0;

        // ── Process Comparisons ──────────────────────────────────────────────
        const completedComp = DashboardDateRangeService.calculatePercentageChange(
            periodCompletedTasks,
            prevCompletedTasks
        );
        const createdComp = DashboardDateRangeService.calculatePercentageChange(
            periodCreatedTasks,
            prevCreatedTasks
        );
        const hoursComp = DashboardDateRangeService.calculatePercentageChange(
            currentTrackedHours,
            prevTrackedHours
        );
        const attendanceComp = DashboardDateRangeService.calculatePercentageChange(
            currentAttendanceHours,
            prevAttendanceHours
        );
        const projectComp = DashboardDateRangeService.calculatePercentageChange(
            periodProj.completedInPeriod,
            prevPeriodProjectStats
        );

        // ── Process Workload Summary ─────────────────────────────────────────
        const seenUsers = new Set<string>();
        const validMembers = activeMembersRaw.filter((m) => {
            if (!m.userId || !m.userId.isActive || m.userId.status === 'DEACTIVATED') return false;
            const uId = String(m.userId._id);
            if (seenUsers.has(uId)) return false;
            seenUsers.add(uId);
            return true;
        });

        const totalMembers = validMembers.length;
        const averageTasksPerMember = totalMembers > 0
            ? Math.round((openTasks / totalMembers) * 10) / 10
            : 0;

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
            projects: {
                active: proj.active,
                completed: proj.completed,
                total: proj.total,
                onHold: proj.onHold,
                delayed: proj.delayed,
                periodDue: periodProj.dueInPeriod,
                periodCompleted: periodProj.completedInPeriod,
                periodDeliveryRate,
                lifetimeDeliveryRate,
                deliveryRate: displayDeliveryRate,
            },
            tasks: {
                total: tasksAllTime.total,
                completed: tasksAllTime.completed,
                open: openTasks,
                overdue: tasksAllTime.overdue,
                pending: pendingTasks,
                inProgress: tasksAllTime.inProgress,
                cancelled: tasksAllTime.cancelled,
                overduePercentage,
                completionRate: taskCompletionRate,
                statusDistribution,
            },
            workloadSummary: {
                totalMembers,
                overloaded: 0, // Enriched via workload endpoint
                balanced: totalMembers,
                underCapacity: 0,
                unassignedTasks: unassignedTasksCount,
                averageTasksPerMember,
            },
            periodMetrics: {
                completedTasks: periodCompletedTasks,
                createdTasks: periodCreatedTasks,
                dueTasks: periodDueTasks,
                relevantTasks: periodRelevantTasks,
                completionRate: periodCompletionRate,
                trackedHours: currentTrackedHours,
                attendanceHours: currentAttendanceHours,
            },
            comparisons: {
                completedTasks: {
                    current: periodCompletedTasks,
                    previous: prevCompletedTasks,
                    ...completedComp,
                },
                createdTasks: {
                    current: periodCreatedTasks,
                    previous: prevCreatedTasks,
                    ...createdComp,
                },
                trackedHours: {
                    current: currentTrackedHours,
                    previous: prevTrackedHours,
                    ...hoursComp,
                },
                attendanceHours: {
                    current: currentAttendanceHours,
                    previous: prevAttendanceHours,
                    ...attendanceComp,
                },
                projectsCompleted: {
                    current: periodProj.completedInPeriod,
                    previous: prevPeriodProjectStats,
                    ...projectComp,
                },
            },
        };
    }
}
