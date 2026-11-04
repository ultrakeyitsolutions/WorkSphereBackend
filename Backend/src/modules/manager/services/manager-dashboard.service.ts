import { Types } from 'mongoose';
import { ManagerAccessScope } from './team-access.service';
import { Team } from '../../teams/team.model';
import { User } from '../../users/user.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus, ProjectPriority } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveStatus } from '../../attendance/attendance.types';
import { EscalationCase } from '../../escalation/models/EscalationCase';
import { EscalationCaseStatus } from '../../escalation/constants/escalation.constants';
import { TimeTracking, TrackingState } from '../../task-tracking/time-tracking.model';
import { PresenceService } from '../../../sockets/presence.service';
import { AppError } from '../../../utils/AppError';

export interface DashboardFilterDto {
    period?: 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';
    startDate?: string;
    endDate?: string;
    teamId?: string;
    employeeId?: string;
    projectId?: string;
}

export class ManagerDashboardService {
    /**
     * Parse date range from period or explicit dates
     */
    public static resolveDateRange(query: DashboardFilterDto): { start: Date; end: Date; startYmd: string; endYmd: string } {
        const now = new Date();
        let start: Date;
        let end: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const period = query.period || 'today';

        if (period === 'today') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        } else if (period === 'this_week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
            start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
        } else if (period === 'this_month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        } else if (period === 'last_month') {
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        } else if (period === 'custom' && query.startDate && query.endDate) {
            start = new Date(query.startDate);
            end = new Date(query.endDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                throw AppError.badRequest('Invalid startDate or endDate format');
            }
            if (start > end) {
                throw AppError.badRequest('startDate cannot be after endDate');
            }
        } else {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        }

        const toYmd = (d: Date) => d.toISOString().split('T')[0];
        return { start, end, startYmd: toYmd(start), endYmd: toYmd(end) };
    }

    /**
     * Compute aggregated dashboard metrics strictly within authorized scope
     */
    public static async getDashboardOverview(scope: ManagerAccessScope, query: DashboardFilterDto) {
        const companyId = scope.companyId;
        const dateRange = this.resolveDateRange(query);

        // ── 1. Resolve Target Scopes Applying User Filters ─────────────────────
        let targetTeamIds = [...scope.allTeamIds];
        if (query.teamId) {
            if (!Types.ObjectId.isValid(query.teamId)) throw AppError.badRequest('Invalid teamId');
            const requestedTeamId = new Types.ObjectId(query.teamId);
            const hasAccess = scope.allTeamIds.some((id) => id.equals(requestedTeamId));
            if (!hasAccess && !scope.isCompanyAdmin) {
                throw AppError.forbidden('Forbidden: You do not have access to the requested team');
            }
            targetTeamIds = [requestedTeamId];
        }

        let targetEmployeeIds = [...scope.allAccessibleEmployeeIds];
        if (query.employeeId) {
            if (!Types.ObjectId.isValid(query.employeeId)) throw AppError.badRequest('Invalid employeeId');
            const requestedEmpId = new Types.ObjectId(query.employeeId);
            const hasAccess = scope.allAccessibleEmployeeIds.some((id) => id.equals(requestedEmpId));
            if (!hasAccess && !scope.isCompanyAdmin) {
                throw AppError.forbidden('Forbidden: You do not have access to the requested employee');
            }
            targetEmployeeIds = [requestedEmpId];
        } else if (query.teamId) {
            // Narrow employees to selected team members
            const selectedTeam = await Team.findOne({ _id: query.teamId, companyId }).lean();
            if (selectedTeam) {
                const teamEmpSet = new Set<string>();
                if (selectedTeam.leadId) teamEmpSet.add(selectedTeam.leadId.toString());
                (selectedTeam.memberIds || []).forEach((id) => teamEmpSet.add(id.toString()));
                targetEmployeeIds = targetEmployeeIds.filter((id) => teamEmpSet.has(id.toString()));
            }
        }

        let targetProjectIds = [...scope.allAccessibleProjectIds];
        if (query.projectId) {
            if (!Types.ObjectId.isValid(query.projectId)) throw AppError.badRequest('Invalid projectId');
            const requestedProjId = new Types.ObjectId(query.projectId);
            const hasAccess = scope.allAccessibleProjectIds.some((id) => id.equals(requestedProjId));
            if (!hasAccess && !scope.isCompanyAdmin) {
                throw AppError.forbidden('Forbidden: You do not have access to the requested project');
            }
            targetProjectIds = [requestedProjId];
        } else if (query.teamId) {
            // Narrow projects to selected team projects
            const selectedTeam = await Team.findOne({ _id: query.teamId, companyId }).lean();
            if (selectedTeam) {
                const teamProjSet = new Set((selectedTeam.projectIds || []).map(String));
                targetProjectIds = targetProjectIds.filter((id) => teamProjSet.has(id.toString()));
            }
        }

        // ── 2. Team Overview Metrics ───────────────────────────────────────────
        const totalAssignedTeams = targetTeamIds.length;
        const totalEmployees = targetEmployeeIds.length;

        let activeEmployees = 0;
        let offlineEmployees = 0;
        for (const empId of targetEmployeeIds) {
            if (PresenceService.isUserOnline(empId.toString())) {
                activeEmployees++;
            } else {
                offlineEmployees++;
            }
        }

        const todayYmd = new Date().toISOString().split('T')[0];

        // Employees on leave today
        const leavesToday = await LeaveRequest.find({
            companyId,
            employeeId: { $in: targetEmployeeIds },
            status: LeaveStatus.APPROVED,
            startDate: { $lte: todayYmd },
            endDate: { $gte: todayYmd },
        } as any).distinct('employeeId');
        const employeesOnLeave = leavesToday.length;

        // Employees currently on break
        const employeesOnBreak = await TimeTracking.countDocuments({
            companyId,
            userId: { $in: targetEmployeeIds },
            state: TrackingState.PAUSED,
        });

        // ── 3. Project Overview Metrics ────────────────────────────────────────
        const projects = await Project.find({
            _id: { $in: targetProjectIds },
            companyId,
            deletedAt: null,
        }).select('status priority startDate endDate actualEndDate').lean();

        const totalProjects = projects.length;
        let activeProjects = 0;
        let completedProjects = 0;
        let delayedProjects = 0;
        let projectsAtRisk = 0;

        const nowDate = new Date();
        for (const p of projects) {
            if (p.status === ProjectStatus.COMPLETED) {
                completedProjects++;
            } else {
                activeProjects++;
                if (p.endDate && new Date(p.endDate) < nowDate) {
                    delayedProjects++;
                }
                if (p.priority === ProjectPriority.HIGH || p.priority === ProjectPriority.CRITICAL || (p.endDate && new Date(p.endDate) < nowDate)) {
                    projectsAtRisk++;
                }
            }
        }

        // ── 4. Task Overview Metrics ───────────────────────────────────────────
        const taskFilter: any = {
            companyId,
            $or: [
                { projectId: { $in: targetProjectIds } },
                { assignedToId: { $in: targetEmployeeIds } },
            ],
        };

        const tasks = await Task.find(taskFilter)
            .populate('statusId', 'name isCompleted')
            .populate('stageId', 'name')
            .select('statusId stageId priority dueDate deliveryDate progress assignedToId createdAt')
            .lean();

        const totalTasks = tasks.length;
        let completedTasks = 0;
        let pendingTasks = 0;
        let inProgressTasks = 0;
        let overdueTasks = 0;
        let blockedTasks = 0;
        let reopenedTasks = 0;

        for (const t of tasks as any[]) {
            const isCompleted = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isCompleted) {
                completedTasks++;
            } else {
                if (t.progress > 0) {
                    inProgressTasks++;
                } else {
                    pendingTasks++;
                }
                if (t.dueDate && new Date(t.dueDate) < nowDate) {
                    overdueTasks++;
                }
            }

            if (t.priority === 'BLOCKER' || t.priority === 'CRITICAL') {
                blockedTasks++;
            }
        }

        // ── 5. Attendance Overview Metrics ─────────────────────────────────────
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: targetEmployeeIds },
            date: { $gte: dateRange.startYmd, $lte: dateRange.endYmd },
        }).select('status actual metrics punchStatus employeeId date').lean();

        let presentEmployees = 0;
        let absentEmployees = 0;
        let lateCheckIns = 0;
        let earlyCheckOuts = 0;
        let missingCheckOuts = 0;
        let totalWorkedMinutes = 0;

        for (const att of attendanceRecords as any[]) {
            if (att.status === AttendanceStatus.PRESENT || att.status === AttendanceStatus.HALF_DAY) {
                presentEmployees++;
            } else if (att.status === AttendanceStatus.ABSENT) {
                absentEmployees++;
            }

            if (att.metrics?.lateMinutes > 0 || att.punchStatus === 'LATE') {
                lateCheckIns++;
            }
            if (att.metrics?.earlyLeaveMinutes > 0) {
                earlyCheckOuts++;
            }
            if (att.actual?.firstCheckIn && !att.actual?.lastCheckOut) {
                missingCheckOuts++;
            }
            if (att.actual?.workedMinutes) {
                totalWorkedMinutes += att.actual.workedMinutes;
            }
        }

        const totalWorkingHours = Math.round((totalWorkedMinutes / 60) * 10) / 10;

        // ── 6. Performance Overview Metrics ────────────────────────────────────
        const teamTaskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const projectCompletionRate = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0;

        let onTimeTasksCount = 0;
        for (const t of tasks as any[]) {
            const isCompleted = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isCompleted) {
                if (!t.dueDate || (t.deliveryDate && new Date(t.deliveryDate) <= new Date(t.dueDate))) {
                    onTimeTasksCount++;
                }
            }
        }
        const onTimeTaskDelivery = completedTasks > 0 ? Math.round((onTimeTasksCount / completedTasks) * 100) : 100;

        // Workload distribution
        const employeeTaskCountMap = new Map<string, number>();
        targetEmployeeIds.forEach((id) => employeeTaskCountMap.set(id.toString(), 0));
        tasks.forEach((t) => {
            if (t.assignedToId) {
                const idStr = String(t.assignedToId);
                employeeTaskCountMap.set(idStr, (employeeTaskCountMap.get(idStr) || 0) + 1);
            }
        });

        // ── 7. Management Overview Metrics ─────────────────────────────────────
        const [pendingLeaves, pendingEscalations] = await Promise.all([
            LeaveRequest.countDocuments({
                companyId,
                employeeId: { $in: targetEmployeeIds },
                status: LeaveStatus.PENDING,
            } as any),
            EscalationCase.countDocuments({
                companyId,
                employeeId: { $in: targetEmployeeIds },
                status: { $in: [EscalationCaseStatus.PENDING, EscalationCaseStatus.ACKNOWLEDGED, EscalationCaseStatus.UNDER_REVIEW, EscalationCaseStatus.AWAITING_EMPLOYEE] },
            }),
        ]);

        const upcomingDeadlines = tasks.filter((t) => {
            if (!t.dueDate) return false;
            const due = new Date(t.dueDate);
            const next7Days = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);
            return due >= nowDate && due <= next7Days && (t.progress ?? 0) < 100;
        }).length;

        return {
            teamOverview: {
                totalAssignedTeams,
                totalEmployees,
                activeEmployees,
                offlineEmployees,
                employeesOnLeave,
                employeesCurrentlyOnBreak: employeesOnBreak,
            },
            projectOverview: {
                totalAccessibleProjects: totalProjects,
                activeProjects,
                completedProjects,
                projectsAtRisk,
                delayedProjects,
                upcomingMilestones: 0,
            },
            taskOverview: {
                totalTasks,
                pendingTasks,
                inProgressTasks,
                completedTasks,
                overdueTasks,
                blockedTasks,
                reopenedTasks,
            },
            attendanceOverview: {
                presentEmployees,
                absentEmployees,
                lateCheckIns,
                earlyCheckOuts,
                missingCheckOuts,
                totalWorkingHours,
            },
            performanceOverview: {
                teamTaskCompletionRate,
                projectCompletionRate,
                onTimeTaskDelivery,
                averageTaskCompletionHours: 0,
                workloadDistribution: Array.from(employeeTaskCountMap.entries()).map(([employeeId, count]) => ({
                    employeeId,
                    taskCount: count,
                })),
            },
            managementOverview: {
                pendingApprovals: pendingLeaves,
                pendingEmployeeExplanations: pendingEscalations,
                unresolvedEscalations: pendingEscalations,
                upcomingDeadlines,
                criticalTeamNotifications: blockedTasks + overdueTasks,
            },
            meta: {
                reportingPeriod: {
                    period: query.period || 'today',
                    startDate: dateRange.startYmd,
                    endDate: dateRange.endYmd,
                },
                filtersApplied: {
                    teamId: query.teamId || null,
                    employeeId: query.employeeId || null,
                    projectId: query.projectId || null,
                },
                dataScope: {
                    teamsCount: targetTeamIds.length,
                    employeesCount: targetEmployeeIds.length,
                    projectsCount: targetProjectIds.length,
                },
                generatedAt: new Date().toISOString(),
            },
        };
    }
}
export default ManagerDashboardService;
