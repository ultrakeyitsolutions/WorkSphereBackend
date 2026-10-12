import { Types } from 'mongoose';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Attendance } from '../../attendance/attendance.model';
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
            allTimeTaskStats,
            periodCompletedTasks,
            periodCreatedTasks,
            periodTimeTracking,
            periodAttendance,
            prevCompletedTasks,
            prevCreatedTasks,
            prevTimeTracking,
        ] = await Promise.all([
            // 1. Projects aggregation
            Project.aggregate([
                { $match: projectMatch },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        active: {
                            $sum: {
                                $cond: [{ $eq: ['$status', ProjectStatus.ACTIVE] }, 1, 0],
                            },
                        },
                        completed: {
                            $sum: {
                                $cond: [{ $eq: ['$status', ProjectStatus.COMPLETED] }, 1, 0],
                            },
                        },
                    },
                },
            ]),

            // 2. All-time tasks snapshot
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

            // 3. Period completed tasks
            Task.countDocuments({
                ...taskMatch,
                completedDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 4. Period created tasks
            Task.countDocuments({
                ...taskMatch,
                createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 5. Period tracked seconds (TimeTracking)
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

            // 6. Period attendance worked minutes
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

            // 7. Previous period completed tasks
            Task.countDocuments({
                ...taskMatch,
                completedDate: { $gte: prevStartDate, $lte: prevEndDate },
            }),

            // 8. Previous period created tasks
            Task.countDocuments({
                ...taskMatch,
                createdAt: { $gte: prevStartDate, $lte: prevEndDate },
            }),

            // 9. Previous period tracked seconds
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
        ]);

        const proj = projectStats[0] || { total: 0, active: 0, completed: 0 };
        const deliveryRate = proj.total > 0
            ? Math.round((proj.completed / proj.total) * 10000) / 100
            : 0;

        const tasksAllTime = allTimeTaskStats[0] || { total: 0, completed: 0, overdue: 0 };
        const openTasks = Math.max(0, tasksAllTime.total - tasksAllTime.completed);

        const currentTrackedHours = periodTimeTracking[0]?.totalSeconds
            ? Math.round((periodTimeTracking[0].totalSeconds / 3600) * 100) / 100
            : 0;

        const currentAttendanceHours = periodAttendance[0]?.totalMinutes
            ? Math.round((periodAttendance[0].totalMinutes / 60) * 100) / 100
            : 0;

        const prevTrackedHours = prevTimeTracking[0]?.totalSeconds
            ? Math.round((prevTimeTracking[0].totalSeconds / 3600) * 100) / 100
            : 0;

        const periodCompletionRate = periodCreatedTasks > 0
            ? Math.round((periodCompletedTasks / periodCreatedTasks) * 10000) / 100
            : null;

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
                deliveryRate,
            },
            tasks: {
                total: tasksAllTime.total,
                completed: tasksAllTime.completed,
                open: openTasks,
                overdue: tasksAllTime.overdue,
            },
            periodMetrics: {
                completedTasks: periodCompletedTasks,
                createdTasks: periodCreatedTasks,
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
            },
        };
    }
}
