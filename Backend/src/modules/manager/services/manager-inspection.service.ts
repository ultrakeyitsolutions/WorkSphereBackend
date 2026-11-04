import { Types } from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { ManagerAccessScope, TeamAccessService } from './team-access.service';
import { Team } from '../../teams/team.model';
import { User } from '../../users/user.model';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { EscalationCase } from '../../escalation/models/EscalationCase';
import { EscalationCaseStatus } from '../../escalation/constants/escalation.constants';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { PresenceService } from '../../../sockets/presence.service';

export class ManagerInspectionService {
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 7: TEAM MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get list of authorized teams for manager
     */
    public static async getAuthorizedTeams(scope: ManagerAccessScope) {
        const teams = await Team.find({
            _id: { $in: scope.allTeamIds },
            companyId: scope.companyId,
            isActive: true,
            isArchived: false,
        })
            .populate('leadId', 'name email avatar')
            .populate('departmentId', 'name')
            .lean();

        return teams.map((t: any) => ({
            id: t._id,
            name: t.name,
            code: t.code,
            description: t.description,
            isPrimary: scope.primaryTeamIds.some((pId) => pId.equals(t._id)),
            department: t.departmentId ? { id: t.departmentId._id, name: t.departmentId.name } : null,
            lead: t.leadId ? { id: t.leadId._id, name: t.leadId.name, email: t.leadId.email, avatar: t.leadId.avatar } : null,
            membersCount: (t.memberIds || []).length,
            projectsCount: (t.projectIds || []).length,
            createdAt: t.createdAt,
        }));
    }

    /**
     * Get specific team details if authorized
     */
    public static async getTeamDetails(scope: ManagerAccessScope, teamIdStr: string) {
        await TeamAccessService.assertTeamAccess(scope.companyId.toString(), scope.managerId.toString(), teamIdStr);

        const team = await Team.findOne({
            _id: teamIdStr,
            companyId: scope.companyId,
            isArchived: false,
        })
            .populate('leadId', 'name email avatar phoneNumber status')
            .populate('departmentId', 'name')
            .populate('memberIds', 'name email avatar phoneNumber status updatedAt')
            .populate('projectIds', 'name status priority startDate endDate')
            .lean();

        if (!team) throw AppError.notFound('Team not found');

        return {
            id: team._id,
            name: team.name,
            code: team.code,
            description: team.description,
            isPrimary: scope.primaryTeamIds.some((pId) => pId.equals(team._id)),
            department: team.departmentId,
            lead: team.leadId,
            members: (team.memberIds || []).map((m: any) => ({
                id: m._id,
                name: m.name,
                email: m.email,
                avatar: m.avatar,
                status: m.status,
                isOnline: PresenceService.isUserOnline(m._id.toString()),
                lastLoginAt: m.lastLoginAt || m.updatedAt,
            })),
            projects: team.projectIds,
            createdAt: team.createdAt,
        };
    }

    /**
     * Get team members with presence and roles
     */
    public static async getTeamMembers(scope: ManagerAccessScope, teamIdStr: string) {
        await TeamAccessService.assertTeamAccess(scope.companyId.toString(), scope.managerId.toString(), teamIdStr);

        const team = await Team.findOne({ _id: teamIdStr, companyId: scope.companyId })
            .populate('memberIds', 'name email avatar phoneNumber status updatedAt')
            .populate('leadId', 'name email avatar')
            .lean();

        if (!team) throw AppError.notFound('Team not found');

        const members = (team.memberIds || []).map((m: any) => ({
            id: m._id,
            name: m.name,
            email: m.email,
            avatar: m.avatar,
            phoneNumber: m.phoneNumber,
            status: m.status,
            isLead: team.leadId ? String((team.leadId as any)._id) === String(m._id) : false,
            isOnline: PresenceService.isUserOnline(m._id.toString()),
            lastLoginAt: m.lastLoginAt || m.updatedAt,
        }));

        return { teamId: team._id, teamName: team.name, members };
    }

    /**
     * Get team overview metrics (tasks, projects, attendance)
     */
    public static async getTeamOverview(scope: ManagerAccessScope, teamIdStr: string) {
        await TeamAccessService.assertTeamAccess(scope.companyId.toString(), scope.managerId.toString(), teamIdStr);

        const team = await Team.findOne({ _id: teamIdStr, companyId: scope.companyId }).lean();
        if (!team) throw AppError.notFound('Team not found');

        const memberIds = (team.memberIds || []).map((id) => new Types.ObjectId(id));
        const projectIds = (team.projectIds || []).map((id) => new Types.ObjectId(id));

        const [tasks, activeProjectsCount, presentTodayCount] = await Promise.all([
            Task.find({
                companyId: scope.companyId,
                $or: [{ projectId: { $in: projectIds } }, { assignedToId: { $in: memberIds } }],
            })
                .populate('statusId', 'isCompleted')
                .select('statusId priority dueDate deliveryDate progress')
                .lean(),
            Project.countDocuments({ _id: { $in: projectIds }, status: ProjectStatus.ACTIVE, deletedAt: null }),
            Attendance.countDocuments({
                companyId: scope.companyId,
                employeeId: { $in: memberIds },
                date: new Date().toISOString().split('T')[0],
                status: { $in: [AttendanceStatus.PRESENT, AttendanceStatus.HALF_DAY] },
            }),
        ]);

        const totalTasks = tasks.length;
        let completedTasks = 0;
        let overdueTasks = 0;
        const now = new Date();

        for (const t of tasks as any[]) {
            const isCompleted = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isCompleted) completedTasks++;
            else if (t.dueDate && new Date(t.dueDate) < now) overdueTasks++;
        }

        return {
            team: { id: team._id, name: team.name, code: team.code },
            membersCount: memberIds.length,
            presentTodayCount,
            projectsCount: projectIds.length,
            activeProjectsCount,
            tasksSummary: {
                totalTasks,
                completedTasks,
                pendingTasks: totalTasks - completedTasks,
                overdueTasks,
                completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
            },
        };
    }

    /**
     * Get team activity stream
     */
    public static async getTeamActivity(scope: ManagerAccessScope, teamIdStr: string, limit = 20) {
        await TeamAccessService.assertTeamAccess(scope.companyId.toString(), scope.managerId.toString(), teamIdStr);

        const team = await Team.findOne({ _id: teamIdStr, companyId: scope.companyId }).lean();
        if (!team) throw AppError.notFound('Team not found');

        const memberIds = team.memberIds || [];
        const projectIds = team.projectIds || [];

        const activities = await TaskActivity.find({
            companyId: scope.companyId,
            $or: [{ projectId: { $in: projectIds } }, { userId: { $in: memberIds } }],
        })
            .populate('userId', 'name email avatar')
            .populate('taskId', 'title taskNumber')
            .populate('projectId', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return activities.map((a: any) => ({
            id: a._id,
            type: a.type,
            content: a.content,
            user: a.userId ? { id: a.userId._id, name: a.userId.name, avatar: a.userId.avatar } : null,
            task: a.taskId ? { id: a.taskId._id, title: a.taskId.title, number: a.taskId.taskNumber } : null,
            project: a.projectId ? { id: a.projectId._id, name: a.projectId.name } : null,
            createdAt: a.createdAt,
        }));
    }

    /**
     * Get team performance breakdown
     */
    public static async getTeamPerformance(scope: ManagerAccessScope, teamIdStr: string) {
        await TeamAccessService.assertTeamAccess(scope.companyId.toString(), scope.managerId.toString(), teamIdStr);

        const team = await Team.findOne({ _id: teamIdStr, companyId: scope.companyId })
            .populate('memberIds', 'name email avatar')
            .lean();
        if (!team) throw AppError.notFound('Team not found');

        const members = team.memberIds || [];
        const memberIds = members.map((m: any) => m._id);

        const tasks = await Task.find({
            companyId: scope.companyId,
            assignedToId: { $in: memberIds },
        })
            .populate('statusId', 'isCompleted')
            .select('assignedToId progress statusId dueDate deliveryDate')
            .lean();

        const memberStats = members.map((m: any) => {
            const mIdStr = String(m._id);
            const mTasks = tasks.filter((t: any) => String(t.assignedToId) === mIdStr);
            const total = mTasks.length;
            const completed = mTasks.filter((t: any) => t.progress === 100 || t.statusId?.isCompleted === true).length;
            const now = new Date();
            const overdue = mTasks.filter((t: any) => !(t.progress === 100 || t.statusId?.isCompleted === true) && t.dueDate && new Date(t.dueDate) < now).length;

            return {
                employee: { id: m._id, name: m.name, email: m.email, avatar: m.avatar },
                totalTasks: total,
                completedTasks: completed,
                overdueTasks: overdue,
                completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            };
        });

        return {
            teamId: team._id,
            teamName: team.name,
            membersPerformance: memberStats,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 8: INDIVIDUAL EMPLOYEE INSPECTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get accessible employees list for manager
     */
    public static async getAccessibleEmployees(
        scope: ManagerAccessScope,
        query: { page?: number; limit?: number; search?: string }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: any = {
            companyId: scope.companyId,
            userId: { $in: scope.allAccessibleEmployeeIds },
            status: 'ACTIVE',
        };

        if (query.search && query.search.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            const matchingUsers = await User.find({
                _id: { $in: scope.allAccessibleEmployeeIds },
                $or: [{ name: regex }, { email: regex }],
            }).select('_id').lean();
            filter.userId = { $in: matchingUsers.map((u) => u._id) };
        }

        const [members, total] = await Promise.all([
            CompanyMember.find(filter)
                .populate('userId', 'name email avatar phoneNumber status updatedAt')
                .populate('designationId', 'name')
                .populate('roleId', 'name')
                .skip(skip)
                .limit(limit)
                .lean(),
            CompanyMember.countDocuments(filter),
        ]);

        return {
            employees: members.map((m: any) => {
                const u = m.userId;
                return {
                    id: u?._id,
                    name: u?.name,
                    email: u?.email,
                    avatar: u?.avatar,
                    phoneNumber: u?.phoneNumber,
                    status: u?.status,
                    designation: m.designationId ? { id: m.designationId._id, name: m.designationId.name } : null,
                    role: m.roleId ? { id: m.roleId._id, name: m.roleId.name } : null,
                    isOnline: u ? PresenceService.isUserOnline(u._id.toString()) : false,
                    lastLoginAt: (u as any)?.lastLoginAt || (u as any)?.updatedAt,
                    joinedAt: m.joinedAt,
                };
            }),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get single employee detailed profile
     */
    public static async getEmployeeDetails(scope: ManagerAccessScope, employeeIdStr: string) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const [user, member, teams, projects, taskCount, activeTaskCount] = await Promise.all([
            User.findById(employeeIdStr).select('-password').lean(),
            CompanyMember.findOne({ companyId: scope.companyId, userId: employeeIdStr })
                .populate('designationId', 'name')
                .populate('roleId', 'name')
                .lean(),
            Team.find({
                companyId: scope.companyId,
                $or: [{ leadId: employeeIdStr }, { memberIds: employeeIdStr }],
                isArchived: false,
            }).select('name code leadId').lean(),
            ProjectTeamMember.find({ userId: employeeIdStr })
                .populate('projectId', 'name status priority')
                .lean(),
            Task.countDocuments({ companyId: scope.companyId, assignedToId: employeeIdStr }),
            Task.countDocuments({ companyId: scope.companyId, assignedToId: employeeIdStr, progress: { $lt: 100 } }),
        ]);

        if (!user || !member) throw AppError.notFound('Employee not found');

        return {
            profile: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                phoneNumber: user.phoneNumber,
                status: user.status,
                designation: member.designationId,
                role: member.roleId,
                isOnline: PresenceService.isUserOnline(user._id.toString()),
                lastLoginAt: (user as any)?.lastLoginAt || (user as any)?.updatedAt,
                joinedAt: member.joinedAt,
            },
            teams: teams.map((t) => ({
                id: t._id,
                name: t.name,
                code: t.code,
                isLead: String(t.leadId) === employeeIdStr,
            })),
            projects: projects.map((p: any) => p.projectId).filter(Boolean),
            workload: {
                totalTasksAssigned: taskCount,
                activeTasksAssigned: activeTaskCount,
            },
        };
    }

    /**
     * Get employee tasks
     */
    public static async getEmployeeTasks(scope: ManagerAccessScope, employeeIdStr: string) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const tasks = await Task.find({
            companyId: scope.companyId,
            assignedToId: employeeIdStr,
        })
            .populate('projectId', 'name status priority')
            .populate('statusId', 'name isCompleted')
            .populate('stageId', 'name')
            .sort({ dueDate: 1, createdAt: -1 })
            .lean();

        return tasks.map((t: any) => ({
            id: t._id,
            title: t.title,
            itemNumber: t.itemNumber,
            taskNumber: t.taskNumber,
            project: t.projectId ? { id: t.projectId._id, name: t.projectId.name } : null,
            status: t.statusId ? { id: t.statusId._id, name: t.statusId.name } : null,
            stage: t.stageId ? { id: t.stageId._id, name: t.stageId.name } : null,
            priority: t.priority,
            dueDate: t.dueDate,
            deliveryDate: t.deliveryDate,
            progress: t.progress,
            estimatedTime: t.estimatedTime,
            actualHours: t.actualHours,
            createdAt: t.createdAt,
        }));
    }

    /**
     * Get employee attendance history
     */
    public static async getEmployeeAttendance(
        scope: ManagerAccessScope,
        employeeIdStr: string,
        query: { startDate?: string; endDate?: string }
    ) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const filter: any = {
            companyId: scope.companyId,
            employeeId: employeeIdStr,
        };

        if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        }

        const records = await Attendance.find(filter)
            .sort({ date: -1 })
            .limit(60)
            .lean();

        return records.map((r: any) => ({
            id: r._id,
            date: r.date,
            status: r.status,
            firstCheckIn: r.actual?.firstCheckIn,
            lastCheckOut: r.actual?.lastCheckOut,
            workedMinutes: r.actual?.workedMinutes || 0,
            lateMinutes: r.metrics?.lateMinutes || 0,
            earlyLeaveMinutes: r.metrics?.earlyLeaveMinutes || 0,
            overtimeMinutes: r.metrics?.overtimeMinutes || 0,
            source: r.source,
        }));
    }

    /**
     * Get employee timesheets / time tracking
     */
    public static async getEmployeeTimesheets(
        scope: ManagerAccessScope,
        employeeIdStr: string,
        query: { startDate?: string; endDate?: string }
    ) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const filter: any = {
            companyId: scope.companyId,
            userId: employeeIdStr,
        };

        if (query.startDate && query.endDate) {
            filter.createdAt = {
                $gte: new Date(query.startDate),
                $lte: new Date(query.endDate),
            };
        }

        const trackings = await TimeTracking.find(filter)
            .populate('taskId', 'title taskNumber')
            .populate('projectId', 'name')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return trackings.map((t: any) => ({
            id: t._id,
            task: t.taskId ? { id: t.taskId._id, title: t.taskId.title, number: t.taskId.taskNumber } : null,
            project: t.projectId ? { id: t.projectId._id, name: t.projectId.name } : null,
            state: t.state,
            totalDurationSeconds: t.totalDurationSeconds,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        }));
    }

    /**
     * Get employee performance summary
     */
    public static async getEmployeePerformance(scope: ManagerAccessScope, employeeIdStr: string) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const [tasks, attendanceRecords, openEscalationsCount] = await Promise.all([
            Task.find({ companyId: scope.companyId, assignedToId: employeeIdStr })
                .populate('statusId', 'isCompleted')
                .lean(),
            Attendance.find({ companyId: scope.companyId, employeeId: employeeIdStr })
                .sort({ date: -1 })
                .limit(30)
                .lean(),
            EscalationCase.countDocuments({
                companyId: scope.companyId,
                employeeId: employeeIdStr,
                status: { $in: [EscalationCaseStatus.PENDING, EscalationCaseStatus.ACKNOWLEDGED, EscalationCaseStatus.UNDER_REVIEW, EscalationCaseStatus.AWAITING_EMPLOYEE] },
            }),
        ]);

        const totalTasks = tasks.length;
        let completedTasks = 0;
        let overdueTasks = 0;
        let onTimeCompletedCount = 0;
        const now = new Date();

        for (const t of tasks as any[]) {
            const isCompleted = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isCompleted) {
                completedTasks++;
                if (!t.dueDate || (t.deliveryDate && new Date(t.deliveryDate) <= new Date(t.dueDate))) {
                    onTimeCompletedCount++;
                }
            } else if (t.dueDate && new Date(t.dueDate) < now) {
                overdueTasks++;
            }
        }

        let presentDays = 0;
        let lateDays = 0;
        let totalWorkedMinutes = 0;

        for (const a of attendanceRecords as any[]) {
            if (['PRESENT', 'LATE', 'HALF_DAY'].includes(a.status)) presentDays++;
            if (a.metrics?.lateMinutes > 0 || a.punchStatus === 'LATE') lateDays++;
            totalWorkedMinutes += a.actual?.workedMinutes || 0;
        }

        return {
            employeeId: employeeIdStr,
            taskMetrics: {
                totalTasks,
                completedTasks,
                pendingTasks: totalTasks - completedTasks,
                overdueTasks,
                completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
                onTimeDeliveryRate: completedTasks > 0 ? Math.round((onTimeCompletedCount / completedTasks) * 100) : 100,
            },
            attendanceMetrics: {
                evaluatedDays: attendanceRecords.length,
                presentDays,
                lateDays,
                totalWorkingHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
            },
            escalationsCount: openEscalationsCount,
        };
    }

    /**
     * Get employee escalations
     */
    public static async getEmployeeEscalations(scope: ManagerAccessScope, employeeIdStr: string) {
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), employeeIdStr);

        const escalations = await EscalationCase.find({
            companyId: scope.companyId,
            employeeId: employeeIdStr,
        })
            .populate('assignedManager', 'name email avatar')
            .sort({ createdAt: -1 })
            .lean();

        return escalations.map((e: any) => ({
            id: e._id,
            category: e.category,
            escalationLevel: e.escalationLevel,
            status: e.status,
            occurrenceCount: e.occurrenceCount,
            assignedManager: e.assignedManager ? { id: e.assignedManager._id, name: e.assignedManager.name } : null,
            dueAt: e.dueAt,
            explanationText: e.employeeExplanation?.text || null,
            explanationSubmittedAt: e.employeeExplanation?.submittedAt || null,
            createdAt: e.createdAt,
        }));
    }
}
export default ManagerInspectionService;
