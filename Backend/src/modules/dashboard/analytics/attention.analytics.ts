import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveStatus } from '../../attendance/attendance.types';
import { TimesheetApproval } from '../../timesheet/timesheet-approval.model';
import { TimesheetApprovalStatus } from '../../timesheet/timesheet.types';
import { ProjectHealthService } from '../services/project-health.service';
import {
    CompanyAttentionData,
    AttentionTaskItem,
    AttentionProjectItem,
    AttentionLeaveItem,
    AttentionTimesheetItem,
} from '../dashboard.types';

export class AttentionAnalytics {
    public static async getAttentionItems(
        companyId: Types.ObjectId,
        limit = 10,
        now = new Date()
    ): Promise<CompanyAttentionData> {
        const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const cappedLimit = Math.min(Math.max(limit, 1), 30);

        const taskBaseMatch: any = {
            companyId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
            completedDate: null,
        };

        const [
            overdueCount,
            upcomingCount,
            overdueDocs,
            upcomingDocs,
            projects,
            pendingLeaveCount,
            pendingLeavesDocs,
            pendingTimesheetCount,
            pendingTimesheetsDocs,
        ] = await Promise.all([
            // 1. Overdue task count & list
            Task.countDocuments({
                ...taskBaseMatch,
                dueDate: { $lt: now },
            }),
            Task.countDocuments({
                ...taskBaseMatch,
                dueDate: { $gte: now, $lte: threeDaysLater },
            }),
            Task.find({
                ...taskBaseMatch,
                dueDate: { $lt: now },
            })
                .sort({ dueDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .lean(),

            // 2. Upcoming deadlines list
            Task.find({
                ...taskBaseMatch,
                dueDate: { $gte: now, $lte: threeDaysLater },
            })
                .sort({ dueDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ assignedToId: { _id: Types.ObjectId; name: string } }>('assignedToId', 'name')
                .lean(),

            // 3. Active projects for health check
            Project.find({
                companyId,
                deletedAt: null,
                status: { $nin: [ProjectStatus.ARCHIVED, ProjectStatus.CANCELLED] },
            })
                .select('_id name status endDate startDate')
                .lean(),

            // 4. Pending leaves count & list
            LeaveRequest.countDocuments({
                companyId,
                status: LeaveStatus.PENDING,
            }),
            LeaveRequest.find({
                companyId,
                status: LeaveStatus.PENDING,
            })
                .sort({ startDate: 1 })
                .limit(cappedLimit)
                .populate<{ employeeId: { _id: Types.ObjectId; name: string } }>('employeeId', 'name')
                .lean(),

            // 5. Pending timesheets count & list
            TimesheetApproval.countDocuments({
                companyId,
                status: TimesheetApprovalStatus.SUBMITTED,
            }),
            TimesheetApproval.find({
                companyId,
                status: TimesheetApprovalStatus.SUBMITTED,
            })
                .sort({ periodEnd: 1 })
                .limit(cappedLimit)
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .lean(),
        ]);

        // Transform Overdue Tasks
        const overdueTasks: AttentionTaskItem[] = overdueDocs.map((t) => {
            const dueDate = t.dueDate ? new Date(t.dueDate) : now;
            const diffMs = now.getTime() - dueDate.getTime();
            const daysOverdue = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

            return {
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                projectId: String(t.projectId?._id || t.projectId),
                projectName: t.projectId?.name || 'Project',
                assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
                dueDate: dueDate.toISOString(),
                daysOverdue,
                priority: t.priority,
            };
        });

        // Transform Upcoming Deadlines
        const upcomingDeadlines: AttentionTaskItem[] = upcomingDocs.map((t) => ({
            id: String(t._id),
            title: t.title,
            taskNumber: t.taskNumber,
            projectId: String(t.projectId?._id || t.projectId),
            projectName: t.projectId?.name || 'Project',
            assignedTo: t.assignedToId ? { id: String(t.assignedToId._id), name: t.assignedToId.name } : null,
            dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : new Date().toISOString(),
            priority: t.priority,
        }));

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
                $group: {
                    _id: '$projectId',
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $gt: ['$completedDate', null] }, 1, 0] },
                    },
                    overdue: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
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
        const pendingLeaves: AttentionLeaveItem[] = pendingLeavesDocs.map((l) => ({
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
        const pendingTimesheets: AttentionTimesheetItem[] = pendingTimesheetsDocs.map((t) => ({
            id: String(t._id),
            userId: String(t.userId?._id || t.userId),
            userName: t.userId?.name || 'Employee',
            periodStart: new Date(t.periodStart).toISOString(),
            periodEnd: new Date(t.periodEnd).toISOString(),
            submittedAt: t.submittedAt ? new Date(t.submittedAt).toISOString() : undefined,
        }));

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: 'UTC',
            },
            counts: {
                overdueTasks: overdueCount,
                upcomingDeadlines: upcomingCount,
                atRiskProjects: atRiskCount,
                pendingLeaves: pendingLeaveCount,
                pendingTimesheets: pendingTimesheetCount,
            },
            overdueTasks,
            upcomingDeadlines,
            atRiskProjects: cappedAtRisk,
            pendingLeaves,
            pendingTimesheets,
        };
    }
}
