import { Types } from 'mongoose';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveStatus } from '../../attendance/attendance.types';
import { TimesheetApproval } from '../../timesheet/timesheet-approval.model';
import {
    ResolvedDateRange,
    MemberDashboardOverviewData,
} from '../dashboard.types';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';

export class MemberOverviewAnalytics {
    public static async getOverview(
        companyId: Types.ObjectId,
        userId: Types.ObjectId,
        dateRange: ResolvedDateRange,
        now = new Date()
    ): Promise<MemberDashboardOverviewData> {
        const todayStr = DashboardDateRangeService.formatDate(now);

        const taskMatch: any = {
            companyId,
            assignedToId: userId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };

        const [
            teamMemberships,
            managedProjects,
            createdProjects,
            allTimeTaskStats,
            periodCompletedTasks,
            periodAssignedTasks,
            periodTimeTracking,
            periodAttendanceCount,
            todayAttendance,
            pendingLeavesCount,
            latestTimesheet,
        ] = await Promise.all([
            // 1. Project memberships
            ProjectTeamMember.find({ userId }).select('projectId').lean(),
            ProjectInCharge.find({ userId }).select('projectId').lean(),
            Project.find({ companyId, createdById: userId, deletedAt: null }).select('_id').lean(),

            // 2. All-time tasks snapshot for member
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

            // 4. Period created or assigned tasks
            Task.countDocuments({
                ...taskMatch,
                createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            }),

            // 5. Period tracked seconds (TimeTracking)
            TimeTracking.aggregate([
                {
                    $match: {
                        companyId,
                        userId,
                        startedAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
            ]),

            // 6. Distinct attendance days attended in period
            Attendance.countDocuments({
                companyId,
                employeeId: userId,
                date: { $gte: dateRange.startDateStr, $lte: dateRange.endDateStr },
                $or: [
                    { 'actual.firstCheckIn': { $ne: null } },
                    {
                        status: {
                            $in: [
                                AttendanceStatus.PRESENT,
                                AttendanceStatus.HALF_DAY,
                                AttendanceStatus.CHECKED_IN,
                                AttendanceStatus.CHECKED_OUT,
                            ],
                        },
                    },
                ],
            }),

            // 7. Today's attendance
            Attendance.findOne({
                companyId,
                employeeId: userId,
                date: todayStr,
            }).lean(),

            // 8. Pending leave requests count
            LeaveRequest.countDocuments({
                companyId,
                employeeId: userId,
                status: LeaveStatus.PENDING,
            }),

            // 9. Latest timesheet approval record
            TimesheetApproval.findOne({
                companyId,
                userId,
            })
                .sort({ periodEnd: -1 })
                .lean(),
        ]);

        // Distinct project IDs
        const pIdSet = new Set<string>();
        teamMemberships.forEach((m) => pIdSet.add(String(m.projectId)));
        managedProjects.forEach((m) => pIdSet.add(String(m.projectId)));
        createdProjects.forEach((p) => pIdSet.add(String(p._id)));
        const assignedProjectsCount = pIdSet.size;

        const tasksAllTime = allTimeTaskStats[0] || { total: 0, completed: 0, overdue: 0 };
        const openTasks = Math.max(0, tasksAllTime.total - tasksAllTime.completed);
        const completionRate = tasksAllTime.total > 0
            ? Math.round((tasksAllTime.completed / tasksAllTime.total) * 10000) / 100
            : 0;

        const trackedHours = periodTimeTracking[0]?.totalSeconds
            ? Math.round((periodTimeTracking[0].totalSeconds / 3600) * 100) / 100
            : 0;

        const isCheckedIn = todayAttendance
            ? todayAttendance.status === 'CHECKED_IN' ||
              (!!todayAttendance.actual?.firstCheckIn && !todayAttendance.actual?.lastCheckOut)
            : false;

        const checkInTime = todayAttendance?.actual?.firstCheckIn
            ? new Date(todayAttendance.actual.firstCheckIn).toISOString()
            : null;

        return {
            meta: {
                period: dateRange.period,
                startDate: dateRange.startDateStr,
                endDate: dateRange.endDateStr,
                timezone: dateRange.timezone,
                generatedAt: now.toISOString(),
                scope: 'SELF',
                isCompanyWide: false,
            },
            projects: {
                assignedTotal: assignedProjectsCount,
            },
            tasks: {
                total: tasksAllTime.total,
                completed: tasksAllTime.completed,
                open: openTasks,
                overdue: tasksAllTime.overdue,
                completionRate,
            },
            periodMetrics: {
                tasksCompleted: periodCompletedTasks,
                tasksCreatedOrAssigned: periodAssignedTasks,
                trackedHours,
                attendanceDays: periodAttendanceCount,
            },
            todayAttendance: {
                isCheckedIn,
                checkInTime,
                status: todayAttendance?.status || null,
            },
            pendingLeaves: pendingLeavesCount,
            latestTimesheet: latestTimesheet
                ? {
                      periodStart: new Date(latestTimesheet.periodStart).toISOString(),
                      periodEnd: new Date(latestTimesheet.periodEnd).toISOString(),
                      status: latestTimesheet.status,
                  }
                : null,
        };
    }
}
