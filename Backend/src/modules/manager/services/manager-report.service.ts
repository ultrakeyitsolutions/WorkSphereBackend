import { Types } from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { ManagerAccessScope, TeamAccessService } from './team-access.service';
import { Team } from '../../teams/team.model';
import { User } from '../../users/user.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { EscalationCase } from '../../escalation/models/EscalationCase';
import { EscalationCaseStatus } from '../../escalation/constants/escalation.constants';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { ManagerDashboardService, DashboardFilterDto } from './manager-dashboard.service';

export class ManagerReportService {
    // ── Helper: Format standard report response ──
    private static formatReportResponse(
        reportType: string,
        data: any,
        dateRange: { startYmd: string; endYmd: string; period: string },
        filtersApplied: any,
        dataScope: any
    ) {
        return {
            success: true,
            data,
            meta: {
                reportType,
                reportingPeriod: {
                    period: dateRange.period,
                    startDate: dateRange.startYmd,
                    endDate: dateRange.endYmd,
                },
                filtersApplied,
                dataScope,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * Report 1: Overall Team Performance Report
     */
    public static async getTeamPerformanceReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const dateRange = ManagerDashboardService.resolveDateRange(query);
        const companyId = scope.companyId;

        let targetTeamIds = [...scope.allTeamIds];
        if (query.teamId) {
            await TeamAccessService.assertTeamAccess(companyId.toString(), scope.managerId.toString(), query.teamId);
            targetTeamIds = [new Types.ObjectId(query.teamId)];
        }

        const teams = await Team.find({ _id: { $in: targetTeamIds }, companyId, isArchived: false })
            .populate('leadId', 'name email')
            .lean();

        const allMemberIdSet = new Set<string>();
        const allProjectIdSet = new Set<string>();

        teams.forEach((t) => {
            if (t.leadId) allMemberIdSet.add(String((t.leadId as any)._id || t.leadId));
            (t.memberIds || []).forEach((m) => allMemberIdSet.add(String(m)));
            (t.projectIds || []).forEach((p) => allProjectIdSet.add(String(p)));
        });

        const targetMemberIds = Array.from(allMemberIdSet).map((id) => new Types.ObjectId(id));
        const targetProjectIds = Array.from(allProjectIdSet).map((id) => new Types.ObjectId(id));

        const [tasks, projects] = await Promise.all([
            Task.find({
                companyId,
                $or: [{ projectId: { $in: targetProjectIds } }, { assignedToId: { $in: targetMemberIds } }],
            })
                .populate('statusId', 'isCompleted')
                .lean(),
            Project.find({ _id: { $in: targetProjectIds }, deletedAt: null }).lean(),
        ]);

        const totalTasks = tasks.length;
        let completedTasks = 0;
        let overdueTasks = 0;
        let onTimeCount = 0;
        const now = new Date();

        for (const t of tasks as any[]) {
            const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isDone) {
                completedTasks++;
                if (!t.dueDate || (t.deliveryDate && new Date(t.deliveryDate) <= new Date(t.dueDate))) {
                    onTimeCount++;
                }
            } else if (t.dueDate && new Date(t.dueDate) < now) {
                overdueTasks++;
            }
        }

        const taskCompletionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const onTimeDeliveryPercentage = completedTasks > 0 ? Math.round((onTimeCount / completedTasks) * 100) : 100;

        const totalProjects = projects.length;
        const completedProjects = projects.filter((p) => p.status === ProjectStatus.COMPLETED).length;
        const projectCompletionPercentage = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0;

        const summary = {
            totalTeams: teams.length,
            teamSize: targetMemberIds.length,
            totalTasksAssigned: totalTasks,
            completedTasks,
            pendingTasks: totalTasks - completedTasks,
            overdueTasks,
            taskCompletionPercentage,
            onTimeDeliveryPercentage,
            projectCompletionPercentage,
        };

        const breakdown = teams.map((t: any) => {
            const tMemberIds = new Set((t.memberIds || []).map(String));
            if (t.leadId) tMemberIds.add(String(t.leadId._id || t.leadId));

            const tTasks = tasks.filter((task) => task.assignedToId && tMemberIds.has(String(task.assignedToId)));
            const tTotal = tTasks.length;
            const tCompleted = tTasks.filter((task: any) => task.progress === 100 || task.statusId?.isCompleted === true).length;

            return {
                teamId: t._id,
                teamName: t.name,
                teamCode: t.code,
                lead: t.leadId ? { id: t.leadId._id, name: t.leadId.name } : null,
                membersCount: tMemberIds.size,
                totalTasks: tTotal,
                completedTasks: tCompleted,
                completionPercentage: tTotal > 0 ? Math.round((tCompleted / tTotal) * 100) : 0,
            };
        });

        return this.formatReportResponse(
            'TEAM_PERFORMANCE',
            { summary, breakdown },
            { startYmd: dateRange.startYmd, endYmd: dateRange.endYmd, period: query.period || 'today' },
            { teamId: query.teamId || null },
            { teamsCount: teams.length, membersCount: targetMemberIds.length }
        );
    }

    /**
     * Report 2: Individual Employee Performance Report
     */
    public static async getEmployeePerformanceReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const dateRange = ManagerDashboardService.resolveDateRange(query);
        const companyId = scope.companyId;

        let targetEmployeeIds = [...scope.allAccessibleEmployeeIds];
        if (query.employeeId) {
            await TeamAccessService.assertEmployeeAccess(companyId.toString(), scope.managerId.toString(), query.employeeId);
            targetEmployeeIds = [new Types.ObjectId(query.employeeId)];
        }

        const [employees, tasks, attendanceRecords] = await Promise.all([
            User.find({ _id: { $in: targetEmployeeIds } }).select('name email avatar').lean(),
            Task.find({ companyId, assignedToId: { $in: targetEmployeeIds } })
                .populate('statusId', 'isCompleted')
                .lean(),
            Attendance.find({
                companyId,
                employeeId: { $in: targetEmployeeIds },
                date: { $gte: dateRange.startYmd, $lte: dateRange.endYmd },
            }).select('employeeId status actual metrics punchStatus').lean(),
        ]);

        const now = new Date();
        const records = employees.map((emp) => {
            const empIdStr = String(emp._id);
            const empTasks = tasks.filter((t) => String(t.assignedToId) === empIdStr);
            const total = empTasks.length;
            let completed = 0;
            let overdue = 0;
            let onTime = 0;
            let reopened = 0;

            for (const t of empTasks as any[]) {
                const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
                if (isDone) {
                    completed++;
                    if (!t.dueDate || (t.deliveryDate && new Date(t.deliveryDate) <= new Date(t.dueDate))) {
                        onTime++;
                    }
                } else if (t.dueDate && new Date(t.dueDate) < now) {
                    overdue++;
                }
                if (t.isReopen) reopened++;
            }

            const empAtt = attendanceRecords.filter((a) => String(a.employeeId) === empIdStr);
            let presentDays = 0;
            let lateDays = 0;
            let totalWorkedMinutes = 0;

            for (const a of empAtt as any[]) {
                if (['PRESENT', 'LATE', 'HALF_DAY'].includes(a.status)) presentDays++;
                if (a.metrics?.lateMinutes > 0 || a.punchStatus === 'LATE') lateDays++;
                totalWorkedMinutes += a.actual?.workedMinutes || 0;
            }

            return {
                employeeId: emp._id,
                name: emp.name,
                email: emp.email,
                totalTasksAssigned: total,
                completedTasks: completed,
                pendingTasks: total - completed,
                overdueTasks: overdue,
                reopenedTasks: reopened,
                taskCompletionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                onTimeDeliveryPercentage: completed > 0 ? Math.round((onTime / completed) * 100) : 100,
                attendance: {
                    evaluatedDays: empAtt.length,
                    presentDays,
                    lateDays,
                    totalWorkingHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
                },
            };
        });

        return this.formatReportResponse(
            'EMPLOYEE_PERFORMANCE',
            { records },
            { startYmd: dateRange.startYmd, endYmd: dateRange.endYmd, period: query.period || 'today' },
            { employeeId: query.employeeId || null },
            { employeesEvaluated: employees.length }
        );
    }

    /**
     * Report 3: Project Performance Report
     */
    public static async getProjectPerformanceReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        let targetProjectIds = [...scope.allAccessibleProjectIds];
        if (query.projectId) {
            await TeamAccessService.assertProjectAccess(companyId.toString(), scope.managerId.toString(), query.projectId);
            targetProjectIds = [new Types.ObjectId(query.projectId)];
        }

        const [projects, tasks] = await Promise.all([
            Project.find({ _id: { $in: targetProjectIds }, companyId, deletedAt: null })
                .populate('createdById', 'name email')
                .lean(),
            Task.find({ companyId, projectId: { $in: targetProjectIds } })
                .populate('statusId', 'isCompleted')
                .lean(),
        ]);

        const now = new Date();
        const records = projects.map((p: any) => {
            const pTasks = tasks.filter((t) => String(t.projectId) === String(p._id));
            const total = pTasks.length;
            let completed = 0;
            let overdue = 0;
            let blockers = 0;

            for (const t of pTasks as any[]) {
                const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
                if (isDone) completed++;
                else if (t.dueDate && new Date(t.dueDate) < now) overdue++;

                if (t.priority === 'BLOCKER' || t.priority === 'CRITICAL') blockers++;
            }

            const isDelayed = p.endDate && new Date(p.endDate) < now && p.status !== 'COMPLETED';

            return {
                projectId: p._id,
                name: p.name,
                status: p.status,
                priority: p.priority,
                owner: p.createdById ? { id: p.createdById._id, name: p.createdById.name } : null,
                plannedStartDate: p.startDate,
                plannedEndDate: p.endDate,
                actualEndDate: p.actualEndDate,
                isDelayed: !!isDelayed,
                totalTasks: total,
                completedTasks: completed,
                pendingTasks: total - completed,
                overdueTasks: overdue,
                blockersCount: blockers,
                progressPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
            };
        });

        return this.formatReportResponse(
            'PROJECT_PERFORMANCE',
            { records },
            { startYmd: '', endYmd: '', period: 'all' },
            { projectId: query.projectId || null },
            { projectsCount: projects.length }
        );
    }

    /**
     * Report 4: Task Management Report
     */
    public static async getTaskManagementReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        const filter: any = {
            companyId,
            $or: [
                { projectId: { $in: scope.allAccessibleProjectIds } },
                { assignedToId: { $in: scope.allAccessibleEmployeeIds } },
            ],
        };

        if (query.projectId) filter.projectId = new Types.ObjectId(query.projectId);
        if (query.employeeId) filter.assignedToId = new Types.ObjectId(query.employeeId);

        const tasks = await Task.find(filter)
            .populate('projectId', 'name')
            .populate('assignedToId', 'name')
            .populate('statusId', 'name isCompleted')
            .populate('stageId', 'name')
            .lean();

        const totalTasks = tasks.length;
        let completed = 0;
        let inProgress = 0;
        let pending = 0;
        let overdue = 0;
        let blocked = 0;
        let reopened = 0;
        const now = new Date();

        const projectDistribution = new Map<string, { name: string; count: number }>();
        const employeeDistribution = new Map<string, { name: string; count: number }>();

        for (const t of tasks as any[]) {
            const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isDone) completed++;
            else {
                if (t.progress > 0) inProgress++;
                else pending++;
                if (t.dueDate && new Date(t.dueDate) < now) overdue++;
            }

            if (t.priority === 'BLOCKER' || t.priority === 'CRITICAL') blocked++;
            if (t.isReopen) reopened++;

            if (t.projectId) {
                const pId = String(t.projectId._id || t.projectId);
                const name = t.projectId.name || 'Project';
                const cur = projectDistribution.get(pId) || { name, count: 0 };
                cur.count++;
                projectDistribution.set(pId, cur);
            }

            if (t.assignedToId) {
                const uId = String(t.assignedToId._id || t.assignedToId);
                const name = t.assignedToId.name || 'Employee';
                const cur = employeeDistribution.get(uId) || { name, count: 0 };
                cur.count++;
                employeeDistribution.set(uId, cur);
            }
        }

        const metrics = {
            totalTasks,
            completedTasks: completed,
            inProgressTasks: inProgress,
            pendingTasks: pending,
            overdueTasks: overdue,
            blockedTasks: blocked,
            reopenedTasks: reopened,
        };

        return this.formatReportResponse(
            'TASK_MANAGEMENT',
            {
                metrics,
                byProject: Array.from(projectDistribution.entries()).map(([projectId, d]) => ({ projectId, ...d })),
                byEmployee: Array.from(employeeDistribution.entries()).map(([employeeId, d]) => ({ employeeId, ...d })),
            },
            { startYmd: '', endYmd: '', period: 'all' },
            { projectId: query.projectId || null, employeeId: query.employeeId || null },
            { totalEvaluated: totalTasks }
        );
    }

    /**
     * Report 5: Attendance and Timesheet Report
     */
    public static async getAttendanceTimesheetReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const dateRange = ManagerDashboardService.resolveDateRange(query);
        const companyId = scope.companyId;

        const targetEmployeeIds = query.employeeId
            ? [new Types.ObjectId(query.employeeId)]
            : scope.allAccessibleEmployeeIds;

        const [employees, attendance] = await Promise.all([
            User.find({ _id: { $in: targetEmployeeIds } }).select('name email avatar').lean(),
            Attendance.find({
                companyId,
                employeeId: { $in: targetEmployeeIds },
                date: { $gte: dateRange.startYmd, $lte: dateRange.endYmd },
            }).lean(),
        ]);

        const records = employees.map((emp) => {
            const empIdStr = String(emp._id);
            const records = attendance.filter((a) => String(a.employeeId) === empIdStr);

            let presentDays = 0;
            let absentDays = 0;
            let lateCheckIns = 0;
            let earlyCheckOuts = 0;
            let missingCheckOuts = 0;
            let totalWorkedMinutes = 0;

            for (const a of records as any[]) {
                if (['PRESENT', 'LATE', 'HALF_DAY'].includes(a.status)) presentDays++;
                else if (a.status === AttendanceStatus.ABSENT) absentDays++;

                if (a.metrics?.lateMinutes > 0 || a.punchStatus === 'LATE') lateCheckIns++;
                if (a.metrics?.earlyLeaveMinutes > 0) earlyCheckOuts++;
                if (a.actual?.firstCheckIn && !a.actual?.lastCheckOut) missingCheckOuts++;
                totalWorkedMinutes += a.actual?.workedMinutes || 0;
            }

            return {
                employeeId: emp._id,
                name: emp.name,
                email: emp.email,
                presentDays,
                absentDays,
                lateCheckIns,
                earlyCheckOuts,
                missingCheckOuts,
                totalWorkingHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
                evaluatedDays: records.length,
            };
        });

        return this.formatReportResponse(
            'ATTENDANCE_TIMESHEET',
            { records },
            { startYmd: dateRange.startYmd, endYmd: dateRange.endYmd, period: query.period || 'today' },
            { employeeId: query.employeeId || null },
            { employeesEvaluated: employees.length }
        );
    }

    /**
     * Report 6: Workload Distribution Report
     */
    public static async getWorkloadDistributionReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        const [employees, tasks] = await Promise.all([
            User.find({ _id: { $in: scope.allAccessibleEmployeeIds } }).select('name email avatar').lean(),
            Task.find({ companyId, assignedToId: { $in: scope.allAccessibleEmployeeIds } })
                .populate('statusId', 'isCompleted')
                .lean(),
        ]);

        const now = new Date();
        const records = employees.map((emp) => {
            const empIdStr = String(emp._id);
            const empTasks = tasks.filter((t) => String(t.assignedToId) === empIdStr);

            let activeTasks = 0;
            let overdueTasks = 0;
            let criticalTasks = 0;

            for (const t of empTasks as any[]) {
                const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
                if (!isDone) {
                    activeTasks++;
                    if (t.dueDate && new Date(t.dueDate) < now) overdueTasks++;
                    if (t.priority === 'CRITICAL' || t.priority === 'BLOCKER' || t.priority === 'HIGH') {
                        criticalTasks++;
                    }
                }
            }

            // Flag as excessive if active tasks > 10 or overdue > 3
            const isExcessive = activeTasks > 10 || overdueTasks > 3;

            return {
                employeeId: emp._id,
                name: emp.name,
                email: emp.email,
                activeTasks,
                overdueTasks,
                criticalTasks,
                workloadStatus: isExcessive ? 'HIGH' : activeTasks < 3 ? 'LOW' : 'OPTIMAL',
            };
        });

        return this.formatReportResponse(
            'WORKLOAD_DISTRIBUTION',
            { records },
            { startYmd: '', endYmd: '', period: 'current' },
            {},
            { employeesCount: employees.length }
        );
    }

    /**
     * Report 7: Escalation and Compliance Report
     */
    public static async getEscalationReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        const filter: any = {
            companyId,
            employeeId: { $in: scope.allAccessibleEmployeeIds },
        };

        const escalations = await EscalationCase.find(filter)
            .populate('employeeId', 'name email avatar')
            .populate('assignedManager', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        let openCount = 0;
        let acknowledgedCount = 0;
        let resolvedCount = 0;
        let dismissedCount = 0;

        const byCategory = new Map<string, number>();

        for (const e of escalations as any[]) {
            const st = String(e.status || '').toLowerCase();
            if (st === EscalationCaseStatus.PENDING || st === EscalationCaseStatus.UNDER_REVIEW || st === 'open') openCount++;
            else if (st === EscalationCaseStatus.ACKNOWLEDGED) acknowledgedCount++;
            else if (st === EscalationCaseStatus.RESOLVED) resolvedCount++;
            else if (st === EscalationCaseStatus.DISMISSED) dismissedCount++;

            const cat = e.category || 'GENERAL';
            byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
        }

        const summary = {
            totalCases: escalations.length,
            openCases: openCount,
            acknowledgedCases: acknowledgedCount,
            resolvedCases: resolvedCount,
            dismissedCases: dismissedCount,
            categoryBreakdown: Array.from(byCategory.entries()).map(([category, count]) => ({ category, count })),
        };

        const records = escalations.map((e: any) => ({
            id: e._id,
            employee: e.employeeId ? { id: e.employeeId._id, name: e.employeeId.name, email: e.employeeId.email } : null,
            category: e.category,
            escalationLevel: e.escalationLevel,
            status: e.status,
            occurrenceCount: e.occurrenceCount,
            assignedManager: e.assignedManager ? { id: e.assignedManager._id, name: e.assignedManager.name } : null,
            dueAt: e.dueAt,
            hasExplanation: !!e.employeeExplanation?.text,
            createdAt: e.createdAt,
        }));

        return this.formatReportResponse(
            'ESCALATION_COMPLIANCE',
            { summary, records },
            { startYmd: '', endYmd: '', period: 'all' },
            {},
            { totalCases: escalations.length }
        );
    }

    /**
     * Report 8: Team Activity Report
     */
    public static async getTeamActivityReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        const activities = await TaskActivity.find({
            companyId,
            $or: [
                { projectId: { $in: scope.allAccessibleProjectIds } },
                { userId: { $in: scope.allAccessibleEmployeeIds } },
            ],
        })
            .populate('userId', 'name email avatar')
            .populate('taskId', 'title taskNumber')
            .populate('projectId', 'name')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        const records = activities.map((a: any) => ({
            id: a._id,
            type: a.type,
            content: a.content,
            user: a.userId ? { id: a.userId._id, name: a.userId.name, avatar: a.userId.avatar } : null,
            task: a.taskId ? { id: a.taskId._id, title: a.taskId.title, number: a.taskId.taskNumber } : null,
            project: a.projectId ? { id: a.projectId._id, name: a.projectId.name } : null,
            createdAt: a.createdAt,
        }));

        return this.formatReportResponse(
            'TEAM_ACTIVITY',
            { records },
            { startYmd: '', endYmd: '', period: 'recent' },
            {},
            { count: records.length }
        );
    }

    /**
     * Report 9: Deadline and Delivery Report
     */
    public static async getDeadlineDeliveryReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;

        const tasks = await Task.find({
            companyId,
            $or: [
                { projectId: { $in: scope.allAccessibleProjectIds } },
                { assignedToId: { $in: scope.allAccessibleEmployeeIds } },
            ],
            dueDate: { $ne: null },
        })
            .populate('assignedToId', 'name email avatar')
            .populate('projectId', 'name')
            .populate('statusId', 'isCompleted')
            .sort({ dueDate: 1 })
            .lean();

        const now = new Date();
        const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const upcomingDeadlines: any[] = [];
        const missedDeadlines: any[] = [];

        for (const t of tasks as any[]) {
            const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
            const due = new Date(t.dueDate);

            if (!isDone && due < now) {
                missedDeadlines.push({
                    taskId: t._id,
                    title: t.title,
                    taskNumber: t.taskNumber,
                    project: t.projectId ? { id: t.projectId._id, name: t.projectId.name } : null,
                    assignedTo: t.assignedToId ? { id: t.assignedToId._id, name: t.assignedToId.name } : null,
                    dueDate: t.dueDate,
                    delayDays: Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)),
                    priority: t.priority,
                });
            } else if (!isDone && due >= now && due <= next7Days) {
                upcomingDeadlines.push({
                    taskId: t._id,
                    title: t.title,
                    taskNumber: t.taskNumber,
                    project: t.projectId ? { id: t.projectId._id, name: t.projectId.name } : null,
                    assignedTo: t.assignedToId ? { id: t.assignedToId._id, name: t.assignedToId.name } : null,
                    dueDate: t.dueDate,
                    daysRemaining: Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
                    priority: t.priority,
                });
            }
        }

        return this.formatReportResponse(
            'DEADLINE_DELIVERY',
            {
                summary: {
                    totalEvaluated: tasks.length,
                    missedDeadlinesCount: missedDeadlines.length,
                    upcomingDeadlinesCount: upcomingDeadlines.length,
                },
                missedDeadlines,
                upcomingDeadlines,
            },
            { startYmd: '', endYmd: '', period: 'all' },
            {},
            { tasksCount: tasks.length }
        );
    }

    /**
     * Report 10: Management Summary Report
     */
    public static async getManagementSummaryReport(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const [teamPerf, workload, escalations, deadlines] = await Promise.all([
            this.getTeamPerformanceReport(scope, query),
            this.getWorkloadDistributionReport(scope, query),
            this.getEscalationReport(scope, query),
            this.getDeadlineDeliveryReport(scope, query),
        ]);

        const recommendations: string[] = [];

        if (deadlines.data?.summary?.missedDeadlinesCount > 0) {
            recommendations.push(
                `${deadlines.data.summary.missedDeadlinesCount} tasks have missed deadlines and require immediate re-prioritization or resource reallocation.`
            );
        }

        const highWorkloadCount = (workload.data?.records || []).filter((r: any) => r.workloadStatus === 'HIGH').length;
        if (highWorkloadCount > 0) {
            recommendations.push(
                `${highWorkloadCount} employees are currently experiencing heavy task volume. Consider delegating to employees with lower utilization.`
            );
        }

        if (escalations.data?.summary?.openCases > 0) {
            recommendations.push(
                `${escalations.data.summary.openCases} workforce escalations are awaiting managerial resolution or explanation review.`
            );
        }

        if (recommendations.length === 0) {
            recommendations.push('Team performance is within healthy targets across tasks, attendance, and deadlines.');
        }

        return this.formatReportResponse(
            'MANAGEMENT_SUMMARY',
            {
                executiveSummary: teamPerf.data.summary,
                deadlinesOverview: deadlines.data.summary,
                escalationsOverview: escalations.data.summary,
                recommendedActions: recommendations,
            },
            { startYmd: '', endYmd: '', period: query.period || 'today' },
            {},
            { scopeType: 'AUTHORIZED_MANAGEMENT_WORKSPACE' }
        );
    }

    /**
     * Export any authorized report to CSV / Excel format
     */
    public static async exportReport(
        scope: ManagerAccessScope,
        reportType: string,
        query: DashboardFilterDto
    ): Promise<{ filename: string; contentType: string; content: string }> {
        const normalizedType = (reportType || '').toUpperCase();
        let reportData: any;

        switch (normalizedType) {
            case 'TEAM_PERFORMANCE':
                reportData = await this.getTeamPerformanceReport(scope, query);
                break;
            case 'EMPLOYEE_PERFORMANCE':
                reportData = await this.getEmployeePerformanceReport(scope, query);
                break;
            case 'PROJECT_PERFORMANCE':
                reportData = await this.getProjectPerformanceReport(scope, query);
                break;
            case 'TASK_MANAGEMENT':
                reportData = await this.getTaskManagementReport(scope, query);
                break;
            case 'ATTENDANCE_TIMESHEET':
                reportData = await this.getAttendanceTimesheetReport(scope, query);
                break;
            case 'WORKLOAD_DISTRIBUTION':
                reportData = await this.getWorkloadDistributionReport(scope, query);
                break;
            case 'ESCALATION_COMPLIANCE':
                reportData = await this.getEscalationReport(scope, query);
                break;
            case 'DEADLINE_DELIVERY':
                reportData = await this.getDeadlineDeliveryReport(scope, query);
                break;
            default:
                throw AppError.badRequest(`Unsupported export report type: ${reportType}`);
        }

        // Format to CSV
        const csvRows: string[] = [];
        const dateStr = new Date().toISOString().split('T')[0];

        if (normalizedType === 'EMPLOYEE_PERFORMANCE') {
            csvRows.push('Employee Name,Email,Total Tasks,Completed Tasks,Pending Tasks,Overdue Tasks,Reopened Tasks,Completion %,On-Time %,Present Days,Working Hours');
            for (const r of reportData.data.records) {
                csvRows.push(
                    `"${(r.name || '').replace(/"/g, '""')}","${r.email}",${r.totalTasksAssigned},${r.completedTasks},${r.pendingTasks},${r.overdueTasks},${r.reopenedTasks},${r.taskCompletionPercentage}%,${r.onTimeDeliveryPercentage}%,${r.attendance?.presentDays || 0},${r.attendance?.totalWorkingHours || 0}`
                );
            }
        } else if (normalizedType === 'TEAM_PERFORMANCE') {
            csvRows.push('Team Name,Team Code,Members Count,Total Tasks,Completed Tasks,Completion %');
            for (const b of reportData.data.breakdown) {
                csvRows.push(
                    `"${(b.teamName || '').replace(/"/g, '""')}","${b.teamCode || ''}",${b.membersCount},${b.totalTasks},${b.completedTasks},${b.completionPercentage}%`
                );
            }
        } else if (normalizedType === 'PROJECT_PERFORMANCE') {
            csvRows.push('Project Name,Status,Priority,Planned End Date,Is Delayed,Total Tasks,Completed Tasks,Progress %');
            for (const r of reportData.data.records) {
                csvRows.push(
                    `"${(r.name || '').replace(/"/g, '""')}","${r.status}","${r.priority}","${r.plannedEndDate || ''}",${r.isDelayed},${r.totalTasks},${r.completedTasks},${r.progressPercentage}%`
                );
            }
        } else if (normalizedType === 'ATTENDANCE_TIMESHEET') {
            csvRows.push('Employee Name,Email,Present Days,Absent Days,Late Check-Ins,Early Check-Outs,Working Hours');
            for (const r of reportData.data.records) {
                csvRows.push(
                    `"${(r.name || '').replace(/"/g, '""')}","${r.email}",${r.presentDays},${r.absentDays},${r.lateCheckIns},${r.earlyCheckOuts},${r.totalWorkingHours}`
                );
            }
        } else if (normalizedType === 'ESCALATION_COMPLIANCE') {
            csvRows.push('Employee Name,Email,Category,Level,Status,Occurrences,Due Date,Has Explanation');
            for (const r of reportData.data.records) {
                csvRows.push(
                    `"${(r.employee?.name || '').replace(/"/g, '""')}","${r.employee?.email || ''}","${r.category}",${r.escalationLevel},"${r.status}",${r.occurrenceCount},"${r.dueAt || ''}",${r.hasExplanation}`
                );
            }
        } else {
            csvRows.push('Field,Value');
            const metrics = reportData.data.metrics || reportData.data.summary || {};
            for (const [k, v] of Object.entries(metrics)) {
                csvRows.push(`"${k}","${v}"`);
            }
        }

        const content = csvRows.join('\n');
        const filename = `${reportType.toLowerCase()}_report_${dateStr}.csv`;

        return {
            filename,
            contentType: 'text/csv; charset=utf-8',
            content,
        };
    }
}
export default ManagerReportService;
