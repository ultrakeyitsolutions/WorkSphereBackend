import { Types } from 'mongoose';
import { TokenPayload } from '../../utils/tokens';
import { CompanyMember } from '../companyadmin/invitations/company-member.model';
import { TaskActivity, ActivityType } from '../task-activities/task-activity.model';
import { AuditLog } from '../audit-logs/audit-log.model';
import { TaskBug, BugStatus } from '../task-bugs/task-bug.model';
import {
    DashboardData,
    DashboardQueryDto,
    RecentActivityItem,
} from './dashboard.types';
import { DashboardScopeService } from './scope/dashboard-scope.service';
import { ProjectHealthService } from './services/project-health.service';
import { DashboardAlertService } from './services/dashboard-alert.service';
import { SummaryAnalytics } from './analytics/summary.analytics';
import { ProjectAnalytics } from './analytics/project.analytics';
import { ProductionAnalytics } from './analytics/production.analytics';
import { MonitoringAnalytics } from './analytics/monitoring.analytics';
import { TaskAnalytics } from './analytics/task.analytics';
import { ProductivityAnalytics } from './analytics/productivity.analytics';
import { TimesheetAnalytics } from './analytics/timesheet.analytics';
import { AttendanceAnalytics } from './analytics/attendance.analytics';
import { MeetingAnalytics } from './analytics/meeting.analytics';
import { SprintAnalytics } from './analytics/sprint.analytics';

export class DashboardService {
    /**
     * Resolves role-aware and scope-aware dashboard analytics snapshot.
     */
    public static async getDashboardData(
        requester: TokenPayload,
        query: DashboardQueryDto,
        impersonatedCompanyId?: string
    ): Promise<DashboardData> {
        const startTime = Date.now();
        const now = new Date();

        // 1. Resolve Normalized Scope
        const context = await DashboardScopeService.resolveScope(requester, query, impersonatedCompanyId);
        const { companyId, userId, isCompanyWide, dateRange, scopeType } = context;

        // 2. Count Active Employees (for company-wide KPIs)
        let totalEmployees = 0;
        let activeEmployees = 0;

        if (isCompanyWide) {
            const companyMembers = await CompanyMember.find({
                companyId,
                memberType: { $in: ['EMPLOYEE', 'MANAGER'] },
                status: 'ACTIVE',
            })
                .populate<{ userId: { _id: Types.ObjectId; isActive: boolean; status: string } }>('userId', 'isActive status')
                .lean();

            const activeList = companyMembers
                .map((m) => m.userId)
                .filter((u) => u && u.isActive && u.status !== 'DEACTIVATED');

            totalEmployees = companyMembers.length;
            activeEmployees = activeList.length;
        }

        // 3. Parallel Execution of Independent Analytics Engines
        const [
            monitoring,
            projectAnalytics,
            taskAnalytics,
            productivity,
            timesheetAnalytics,
            attendanceAnalytics,
            meetings,
            sprints,
            unresolvedBlockersCount,
            recentTaskActivities,
            recentAuditLogs,
        ] = await Promise.all([
            MonitoringAnalytics.getLiveSnapshot(context, now),
            ProjectAnalytics.getProjectAnalytics(context, now),
            TaskAnalytics.getTaskAnalytics(context, now),
            ProductivityAnalytics.getProductivity(context),
            TimesheetAnalytics.getTimesheetAnalytics(context),
            AttendanceAnalytics.getAttendanceAnalytics(context, activeEmployees),
            MeetingAnalytics.getMeetingAnalytics(context, now),
            SprintAnalytics.getSprintAnalytics(context, now),

            // Blockers count
            (async () => {
                const actMatch: any = { companyId, type: ActivityType.DOUBT, isResolved: false };
                const bugMatch: any = { companyId, status: { $nin: [BugStatus.CLOSED, BugStatus.RESOLVED] } };

                if (!isCompanyWide) {
                    actMatch.userId = userId;
                    bugMatch.assignedTo = userId;
                }

                const [doubts, bugs] = await Promise.all([
                    TaskActivity.countDocuments(actMatch),
                    TaskBug.countDocuments(bugMatch).catch(() => 0),
                ]);
                return doubts + bugs;
            })(),

            // Recent Task Activities
            TaskActivity.find({
                companyId,
                ...(isCompanyWide ? {} : { userId }),
            })
                .populate('userId', 'name')
                .sort({ createdAt: -1 })
                .limit(10)
                .lean(),

            // Recent Audit Logs (Only for company admin)
            isCompanyWide
                ? AuditLog.find({ companyId }).sort({ createdAt: -1 }).limit(10).lean()
                : Promise.resolve([]),
        ]);

        // 4. Production Activity per Project
        const productionByProject = await ProductionAnalytics.getProductionByProject(context, projectAnalytics);

        // 5. Evaluate Project Health
        const projectHealth = projectAnalytics.map((p) =>
            ProjectHealthService.evaluate(
                {
                    projectId: p.projectId,
                    projectName: p.projectName,
                    endDate: null,
                    totalTasks: p.totalTasks,
                    completedTasks: p.completedTasks,
                    overdueTasks: p.overdueTasks,
                    progressPercentage: p.progressPercentage,
                    unresolvedBlockers: unresolvedBlockersCount,
                    isEmployeeScope: !isCompanyWide,
                    myTasks: p.myTasks,
                    myCompletedTasks: p.myCompletedTasks,
                    myOverdueTasks: p.myOverdueTasks,
                    myProgressPercentage: p.myProgressPercentage,
                },
                now
            )
        );

        // 6. Actionable Alerts
        const alerts = DashboardAlertService.generateAlerts({
            isCompanyWide,
            overdueTaskCount: taskAnalytics.overdue,
            projectHealthList: projectHealth,
            attendancePercentage: attendanceAnalytics.attendancePercentage,
            unresolvedBlockersCount,
        });

        // 7. Recent Activities
        const recentActivity: RecentActivityItem[] = [];

        for (const act of recentTaskActivities) {
            recentActivity.push({
                type: act.type,
                userId: String(act.userId?._id || act.userId),
                userName: (act.userId as any)?.name || 'Team Member',
                message: act.content || `Activity on task (${act.type})`,
                entityId: String(act.taskId || act._id),
                timestamp: new Date(act.createdAt).toISOString(),
            });
        }

        for (const log of recentAuditLogs) {
            recentActivity.push({
                type: log.action,
                userId: String(log.actorId || ''),
                userName: log.actorEmail || 'System Admin',
                message: log.description || log.action,
                entityId: String(log._id),
                timestamp: new Date(log.createdAt).toISOString(),
            });
        }

        recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const cappedRecentActivity = recentActivity.slice(0, 15);

        // 8. Summary KPIs
        const liveSummary = monitoring.summary || {
            working: 0,
            idle: 0,
            break: 0,
            meeting: 0,
            offline: 0,
        };

        const activeProjectsCount = projectAnalytics.filter(
            (p) => p.status.toLowerCase() !== 'archived' && p.status.toLowerCase() !== 'completed'
        ).length;

        const summary = SummaryAnalytics.computeSummary({
            context,
            totalEmployees,
            activeEmployees,
            workingNow: liveSummary.working,
            idleNow: liveSummary.idle,
            onBreak: liveSummary.break,
            inMeetings: liveSummary.meeting,
            activeProjects: activeProjectsCount,
            totalTasks: taskAnalytics.total,
            completedTasks: taskAnalytics.completed,
            inProgressTasks: taskAnalytics.inProgress,
            pendingTasks: taskAnalytics.pending,
            overdueTasks: taskAnalytics.overdue,
            totalWorkingMinutes: timesheetAnalytics.totalWorkingMinutes,
            totalActiveMinutes: timesheetAnalytics.totalActiveMinutes,
            totalBreakMinutes: timesheetAnalytics.totalBreakMinutes,
            totalIdleMinutes: timesheetAnalytics.totalIdleMinutes,
            meetingsCount: meetings.today || meetings.items.length,
        });

        const executionDurationMs = Date.now() - startTime;
        if (process.env.NODE_ENV !== 'test') {
            console.log(
                `[Dashboard] Generated for company=${companyId} user=${userId} role=${context.roleName} scope=${scopeType} in ${executionDurationMs}ms`
            );
        }

        return {
            meta: {
                period: dateRange.period,
                startDate: dateRange.startDateStr,
                endDate: dateRange.endDateStr,
                timezone: dateRange.timezone,
                generatedAt: now.toISOString(),
                scope: scopeType,
                isCompanyWide,
            },
            summary,
            projectAnalytics,
            productionByProject,
            monitoring,
            taskAnalytics,
            employeeProductivity: productivity,
            timesheetAnalytics,
            attendanceAnalytics,
            meetings,
            sprints,
            projectHealth,
            recentActivity: cappedRecentActivity,
            alerts,
        };
    }
}
