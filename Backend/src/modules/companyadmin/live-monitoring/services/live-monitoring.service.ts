import { Types } from 'mongoose';
import {
    ILiveOverviewSummary,
    IEmployeePresenceRecord,
    IProjectLiveMetrics,
    IAttendanceSnapshotRecord,
    AlertStatus,
} from '../live-monitoring.types';
import { EmployeePresenceService } from './employee-presence.service';
import { MonitoringActivity } from '../models/monitoring-activity.model';
import { MonitoringAlert } from '../models/monitoring-alert.model';
import { Project } from '../../projects/project.model';
import { ProjectStatus } from '../../projects/project.types';
import { Task } from '../../../tasks/task.model';
import { Attendance, AttendanceStatus } from '../../../attendance/attendance.model';
import CompanyMember from '../../invitations/company-member.model';
import LeaveRequest from '../../../attendance/leave.model';
import { LeaveStatus } from '../../../attendance/attendance.types';
import { Meeting } from '../../../meetings/models/meeting.model';
import { MeetingStatus } from '../../../meetings/meeting.types';
import { MeetingParticipant } from '../../../meetings/models/meeting-participant.model';
import { TimeTracking, TrackingState } from '../../../task-tracking/time-tracking.model';

export class LiveMonitoringService {
    // 5-second in-memory snapshot cache per company to eliminate repeated DB hammering and duplicate React mount effects
    private static overviewCache = new Map<string, { data: ILiveOverviewSummary; cachedAt: number }>();
    private static inFlightOverview = new Map<string, Promise<ILiveOverviewSummary>>();
    private static readonly CACHE_TTL_MS = 5000;

    /**
     * Highly optimized parallelized dashboard overview snapshot aggregation
     */
    public static async getDashboardOverview(
        companyId: string,
        forceRefresh = false
    ): Promise<ILiveOverviewSummary> {
        const nowMs = Date.now();
        if (!forceRefresh) {
            const cached = this.overviewCache.get(companyId);
            if (cached && nowMs - cached.cachedAt < this.CACHE_TTL_MS) {
                return cached.data;
            }
        }

        // Return existing in-flight promise if another request for this company is already executing
        const existingPromise = this.inFlightOverview.get(companyId);
        if (existingPromise) {
            return existingPromise;
        }

        const taskPromise = (async () => {
            try {
                return await this.fetchDashboardOverviewInternal(companyId);
            } finally {
                this.inFlightOverview.delete(companyId);
            }
        })();

        this.inFlightOverview.set(companyId, taskPromise);
        return await taskPromise;
    }

    private static async fetchDashboardOverviewInternal(companyId: string): Promise<ILiveOverviewSummary> {
        const nowMs = Date.now();
        const companyObjId = new Types.ObjectId(companyId);
        const todayStr = new Date().toISOString().split('T')[0];
        const now = new Date();

        // Run ALL independent queries in parallel via Promise.all
        const [
            activeMembers,
            todayAttendances,
            todayApprovedLeaves,
            activeMeetings,
            activeTrackings,
            activeProjectsCount,
            taskStats,
            activeAlertsCount,
            recentActivities,
        ] = await Promise.all([
            // 1. Company members: only need user IDs and count
            CompanyMember.find({ companyId: companyObjId, status: 'ACTIVE' })
                .select('userId')
                .lean(),

            // 2. Today's attendance records: lean projection
            Attendance.find({ companyId: companyObjId, date: todayStr })
                .select('employeeId status punchStatus metrics lateMinutes totalBreakMinutes checkInTime isLate actual')
                .lean(),

            // 3. Today's approved leave records
            LeaveRequest.find({
                companyId: companyObjId as any,
                status: LeaveStatus.APPROVED,
                startDate: { $lte: todayStr },
                endDate: { $gte: todayStr },
            })
                .select('employeeId')
                .lean(),

            // 4. In-progress meetings
            Meeting.find({ companyId: companyObjId, status: MeetingStatus.IN_PROGRESS })
                .select('_id')
                .lean(),

            // 5. Active live time tracking sessions
            TimeTracking.find({
                companyId: companyObjId,
                state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED] },
            })
                .select('userId state taskId projectId')
                .lean(),

            // 6. Active projects count
            Project.countDocuments({ companyId: companyObjId, isArchived: false, status: ProjectStatus.ACTIVE }),

            // 7. Aggregated task status counts
            Task.aggregate([
                {
                    $match: {
                        companyId: companyObjId,
                        isArchived: false,
                        isActive: true,
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: {
                            $sum: {
                                $cond: [
                                    { $or: [{ $eq: ['$status', 'COMPLETED'] }, { $eq: ['$progress', 100] }] },
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
                                            { $ne: ['$status', 'COMPLETED'] },
                                            { $ne: ['$progress', 100] },
                                            { $ne: ['$deliveryDate', null] },
                                            { $lt: ['$deliveryDate', now] },
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        inReview: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'REVIEW'] }, 1, 0],
                            },
                        },
                    },
                },
            ]),

            // 8. Unresolved alerts count
            MonitoringAlert.countDocuments({ companyId: companyObjId, status: AlertStatus.ACTIVE }),

            // 9. Recent 10 activities (uses { companyId: 1, occurredAt: -1 } index)
            MonitoringActivity.find({ companyId: companyObjId })
                .sort({ occurredAt: -1 })
                .limit(10)
                .select('eventId sequence eventType actorId actorName actorAvatar summary occurredAt')
                .lean(),
        ]);

        // Process active meeting participant IDs in parallel if meetings are in progress
        let inMeetingUserSet = new Set<string>();
        if (activeMeetings.length > 0) {
            const meetingIds = activeMeetings.map((m) => m._id);
            const participants = await MeetingParticipant.find({
                meetingId: { $in: meetingIds },
                status: { $in: ['ACCEPTED', 'ATTENDING', 'JOINED'] },
            })
                .select('userId')
                .lean();
            inMeetingUserSet = new Set(participants.map((p) => p.userId.toString()));
        }

        // Build Sets and Maps for O(1) in-memory resolution
        const totalMembers = activeMembers.length;
        const memberUserIds = new Set(activeMembers.map((m: any) => m.userId?.toString()).filter(Boolean));
        const leaveSet = new Set(todayApprovedLeaves.map((l: any) => l.employeeId?.toString()).filter(Boolean));

        const attendanceMap = new Map<string, any>();
        let checkedInCount = 0;
        let lateCount = 0;
        let halfDayCount = 0;

        for (const att of todayAttendances) {
            const empId = att.employeeId?.toString();
            if (empId && memberUserIds.has(empId)) {
                attendanceMap.set(empId, att);
                if (att.status === AttendanceStatus.PRESENT || att.status === AttendanceStatus.HALF_DAY) {
                    checkedInCount++;
                    const isLate = Boolean(
                        att.isLate ||
                        att.punchStatus === 'LATE' ||
                        (att.metrics?.lateMinutes && att.metrics.lateMinutes > 0) ||
                        (att.lateMinutes && att.lateMinutes > 0)
                    );
                    if (isLate) {
                        lateCount++;
                    }
                    if (att.status === AttendanceStatus.HALF_DAY) {
                        halfDayCount++;
                    }
                }
            }
        }

        const activeTrackingMap = new Map<string, any>();
        for (const trk of activeTrackings) {
            const uid = trk.userId?.toString();
            if (uid && memberUserIds.has(uid)) {
                activeTrackingMap.set(uid, trk);
            }
        }

        // Presence & Work State Calculation
        let onlineCount = 0;
        let offlineCount = 0;
        let workingCount = 0;
        let onBreakCount = 0;
        let inMeetingCount = 0;
        let onLeaveCount = 0;

        for (const userId of memberUserIds) {
            const isOnline = EmployeePresenceService.isUserOnline(userId);
            if (isOnline) onlineCount++;
            else offlineCount++;

            const isOnLeave = leaveSet.has(userId);
            const isInMeeting = inMeetingUserSet.has(userId);
            const liveTracking = activeTrackingMap.get(userId);
            const att = attendanceMap.get(userId);

            if (isOnLeave) {
                onLeaveCount++;
            } else if (isInMeeting) {
                inMeetingCount++;
            } else if (liveTracking && liveTracking.state === TrackingState.TRACKING) {
                workingCount++;
            } else if (liveTracking && liveTracking.state === TrackingState.PAUSED) {
                onBreakCount++;
            } else if (att && (att.status === AttendanceStatus.PRESENT || att.status === AttendanceStatus.HALF_DAY)) {
                if (isOnline) workingCount++;
            }
        }

        const onApprovedLeaveCount = leaveSet.size;
        const notCheckedInCount = Math.max(0, totalMembers - checkedInCount - onApprovedLeaveCount);

        // Task Aggregation result
        const tStat = taskStats[0] || { total: 0, completed: 0, overdue: 0, inReview: 0 };
        const tasksInProgress = Math.max(0, tStat.total - tStat.completed);

        const summary: ILiveOverviewSummary = {
            companyId,
            snapshotTimestamp: new Date().toISOString(),
            employees: {
                totalActive: totalMembers,
                online: onlineCount,
                offline: offlineCount,
                working: workingCount,
                onBreak: onBreakCount,
                inMeeting: inMeetingCount,
                onLeave: onLeaveCount,
            },
            presence: {
                totalEmployees: totalMembers,
                onlineEmployees: onlineCount,
                offlineEmployees: offlineCount,
                workingEmployees: workingCount,
                onBreakEmployees: onBreakCount,
                inMeetingEmployees: inMeetingCount,
                onLeaveEmployees: onLeaveCount,
            },
            attendance: {
                checkedIn: checkedInCount,
                notCheckedIn: notCheckedInCount,
                lateArrivals: lateCount,
                halfDay: halfDayCount,
                currentlyOnBreak: onBreakCount,
                onApprovedLeave: onApprovedLeaveCount,
            },
            projects: {
                activeProjects: activeProjectsCount,
                tasksInProgress,
                completedTasks: tStat.completed,
                blockedTasks: 0,
                overdueTasks: tStat.overdue,
                atRiskProjectsCount: 0,
            },
            alerts: {
                activeCount: activeAlertsCount,
                recent: [],
            },
            recentActivity: recentActivities.map((act: any) => ({
                id: act._id.toString(),
                eventId: act.eventId,
                sequence: act.sequence,
                eventType: act.eventType,
                actor: {
                    userId: act.actorId ? act.actorId.toString() : undefined,
                    displayName: act.actorName || 'System',
                    avatar: act.actorAvatar || undefined,
                },
                summary: act.summary,
                occurredAt: act.occurredAt.toISOString(),
            })),
        };

        this.overviewCache.set(companyId, { data: summary, cachedAt: nowMs });
        return summary;
    }

    /**
     * Invalidate overview cache for a company (called when major domain event occurs)
     */
    public static invalidateOverviewCache(companyId?: string): void {
        if (companyId) {
            this.overviewCache.delete(companyId);
        } else {
            this.overviewCache.clear();
        }
    }

    /**
     * Get live monitoring list of employees with presence and task details
     */
    public static async getLiveEmployees(
        companyId: string,
        params: {
            search?: string;
            teamId?: string;
            departmentId?: string;
            projectId?: string;
            presence?: 'ONLINE' | 'OFFLINE';
            workStatus?: string;
            taskStatus?: string;
            sortBy?: 'lastActivity' | 'name' | 'status' | 'recent';
            sortOrder?: 'asc' | 'desc';
            cursor?: string;
            limit?: number;
            page?: number;
            pageSize?: number;
        } = {}
    ): Promise<{ employees: IEmployeePresenceRecord[]; total: number; page: number; limit: number }> {
        const todayStr = new Date().toISOString().split('T')[0];
        let allEmployees = await EmployeePresenceService.resolveCompanyEmployeesPresence(companyId, todayStr);

        // Apply filters
        if (params.search) {
            const query = params.search.toLowerCase();
            allEmployees = allEmployees.filter(
                (e) => e.name.toLowerCase().includes(query) || e.email.toLowerCase().includes(query)
            );
        }

        if (params.departmentId) {
            allEmployees = allEmployees.filter((e) => e.department === params.departmentId);
        }

        if (params.presence) {
            allEmployees = allEmployees.filter((e) => e.presenceStatus === params.presence);
        }

        if (params.workStatus) {
            allEmployees = allEmployees.filter((e) => e.workStatus === params.workStatus);
        }

        if (params.projectId) {
            allEmployees = allEmployees.filter((e) => e.currentTask?.projectId === params.projectId);
        }

        if (params.taskStatus) {
            allEmployees = allEmployees.filter(
                (e) => e.currentTask?.taskStatus === params.taskStatus || e.currentTask?.status === params.taskStatus
            );
        }

        // Sorting
        const order = params.sortOrder === 'asc' ? 1 : -1;
        if (params.sortBy === 'name') {
            allEmployees.sort((a, b) => a.name.localeCompare(b.name) * order);
        } else if (params.sortBy === 'status') {
            allEmployees.sort((a, b) => a.workStatus.localeCompare(b.workStatus) * order);
        } else {
            allEmployees.sort((a, b) => {
                const dateA = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
                const dateB = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
                return (dateB - dateA) * (order === 1 ? -1 : 1);
            });
        }

        const total = allEmployees.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.pageSize || params.limit || 20));
        const skip = (page - 1) * limit;
        const paginated = allEmployees.slice(skip, skip + limit);

        return {
            employees: paginated,
            total,
            page,
            limit,
        };
    }

    /**
     * Get single employee detailed live monitoring record
     */
    public static async getEmployeeLiveDetail(
        companyId: string,
        employeeId: string
    ): Promise<IEmployeePresenceRecord | null> {
        const todayStr = new Date().toISOString().split('T')[0];
        const all = await EmployeePresenceService.resolveCompanyEmployeesPresence(companyId, todayStr);
        return all.find((e) => e.employeeId === employeeId) || null;
    }

    /**
     * Get real-time activity feed with cursor pagination
     */
    public static async getActivityFeed(
        companyId: string,
        params: {
            cursor?: string;
            limit?: number;
            eventType?: string;
            employeeId?: string;
            projectId?: string;
            from?: string;
            to?: string;
        } = {}
    ): Promise<{ items: any[]; nextCursor: string | null; hasMore: boolean }> {
        const companyObjId = new Types.ObjectId(companyId);
        const limit = Math.min(100, Math.max(1, params.limit || 30));

        const filter: any = { companyId: companyObjId };
        if (params.eventType) filter.eventType = params.eventType;
        if (params.employeeId && Types.ObjectId.isValid(params.employeeId)) {
            filter.employeeId = new Types.ObjectId(params.employeeId);
        }
        if (params.projectId && Types.ObjectId.isValid(params.projectId)) {
            filter.projectId = new Types.ObjectId(params.projectId);
        }
        if (params.from || params.to) {
            filter.occurredAt = {};
            if (params.from) filter.occurredAt.$gte = new Date(params.from);
            if (params.to) filter.occurredAt.$lte = new Date(params.to);
        }
        if (params.cursor && Types.ObjectId.isValid(params.cursor)) {
            filter._id = { $lt: new Types.ObjectId(params.cursor) };
        }

        const activities = await MonitoringActivity.find(filter)
            .sort({ occurredAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = activities.length > limit;
        const items = hasMore ? activities.slice(0, limit) : activities;
        const nextCursor = items.length > 0 ? (items[items.length - 1] as any)._id.toString() : null;

        return {
            items: items.map((act) => ({
                id: (act as any)._id.toString(),
                eventId: act.eventId,
                sequence: act.sequence,
                eventType: act.eventType,
                actor: {
                    userId: act.actorId ? act.actorId.toString() : undefined,
                    displayName: act.actorName || 'System',
                    avatar: act.actorAvatar || undefined,
                },
                employee: act.employeeId
                    ? {
                          userId: act.employeeId.toString(),
                          displayName: act.employeeName || undefined,
                      }
                    : undefined,
                project: act.projectId
                    ? {
                          id: act.projectId.toString(),
                          name: act.projectName || undefined,
                      }
                    : undefined,
                task: act.taskId
                    ? {
                          id: act.taskId.toString(),
                          title: act.taskTitle || undefined,
                      }
                    : undefined,
                summary: act.summary,
                occurredAt: act.occurredAt.toISOString(),
                metadata: act.metadata || {},
            })),
            nextCursor: hasMore ? nextCursor : null,
            hasMore,
        };
    }

    /**
     * Get live projects metrics and risk assessments
     */
    public static async getLiveProjects(
        companyId: string,
        params: {
            status?: string;
            riskOnly?: boolean;
            search?: string;
            cursor?: string;
            limit?: number;
            page?: number;
            pageSize?: number;
        } = {}
    ): Promise<{ projects: IProjectLiveMetrics[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const filter: any = { companyId: companyObjId, isArchived: false };
        if (params.status) filter.status = params.status;
        if (params.search) filter.name = { $regex: params.search, $options: 'i' };

        const projects = await Project.find(filter)
            .populate<{ createdById: { _id: Types.ObjectId; name: string } }>('createdById', 'name')
            .lean();

        const now = new Date();
        const projectMetrics: IProjectLiveMetrics[] = [];

        for (const proj of projects) {
            const tasks = await Task.find({
                projectId: (proj as any)._id,
                companyId: companyObjId,
                isArchived: false,
                isActive: true,
            })
                .select('deliveryDate progress status priority')
                .lean();

            const totalTasks = tasks.length;
            const completedTasks = tasks.filter((t: any) => (t as any).status === 'COMPLETED' || t.progress === 100).length;
            const overdueTasks = tasks.filter(
                (t: any) => (t as any).status !== 'COMPLETED' && (t as any).deliveryDate && new Date((t as any).deliveryDate) < now
            ).length;
            const inProgressTasks = totalTasks - completedTasks;
            const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

            const isPastDeadline = (proj as any).endDate && new Date((proj as any).endDate) < now;
            const isAtRisk =
                overdueTasks > 0 ||
                isPastDeadline ||
                ((proj as any).endDate &&
                    (proj as any).endDate < new Date(now.getTime() + 2 * 86400000) &&
                    completionPercentage < 70);

            const riskReasons: string[] = [];
            if (overdueTasks > 0) riskReasons.push(`${overdueTasks} task(s) are overdue`);
            if (isPastDeadline) riskReasons.push('Project passed scheduled deadline');
            else if (isAtRisk) riskReasons.push('Approaching deadline with low completion rate');

            projectMetrics.push({
                id: (proj as any)._id.toString(),
                projectId: (proj as any)._id.toString(),
                name: (proj as any).name,
                code: (proj as any).code || null,
                status: (proj as any).status || 'ACTIVE',
                priority: (proj as any).priority || 'MEDIUM',
                startDate: (proj as any).startDate ? (proj as any).startDate.toISOString() : null,
                endDate: (proj as any).endDate ? (proj as any).endDate.toISOString() : null,
                totalTasks,
                completedTasks,
                inProgressTasks,
                blockedTasks: 0,
                overdueTasks,
                completionPercentage,
                isAtRisk,
                riskReasons,
                taskMetrics: {
                    total: totalTasks,
                    completed: completedTasks,
                    inProgress: inProgressTasks,
                    blocked: 0,
                    overdue: overdueTasks,
                },
            });
        }

        let filtered = projectMetrics;
        if (params.riskOnly) {
            filtered = filtered.filter((p) => p.isAtRisk);
        }

        const total = filtered.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.pageSize || params.limit || 20));
        const skip = (page - 1) * limit;

        return {
            projects: filtered.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }

    /**
     * Get live attendance snapshot for company
     */
    public static async getAttendanceSnapshot(
        companyId: string,
        params: {
            date?: string;
            teamId?: string;
            departmentId?: string;
            status?: string;
            cursor?: string;
            limit?: number;
            page?: number;
            pageSize?: number;
        } = {}
    ): Promise<{ records: IAttendanceSnapshotRecord[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const targetDate = params.date || new Date().toISOString().split('T')[0];

        const members = await CompanyMember.find({
            companyId: companyObjId,
            status: 'ACTIVE',
        })
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>('userId', 'name email avatar')
            .populate<{ designationId: { _id: Types.ObjectId; name: string; department?: string } }>('designationId', 'name department')
            .lean();

        const userIds = members.filter((m: any) => m.userId && m.userId._id).map((m: any) => m.userId._id);

        const attendances = await Attendance.find({
            companyId: companyObjId,
            employeeId: { $in: userIds },
            date: targetDate,
        }).lean();

        const attendanceMap = new Map<string, any>();
        attendances.forEach((a: any) => attendanceMap.set(a.employeeId.toString(), a));

        const approvedLeaves = await LeaveRequest.find({
            companyId: companyObjId as any,
            employeeId: { $in: userIds },
            status: LeaveStatus.APPROVED,
            startDate: { $lte: targetDate },
            endDate: { $gte: targetDate },
        }).lean();
        const leaveSet = new Set(approvedLeaves.map((l: any) => l.employeeId.toString()));

        const snapshotRecords: IAttendanceSnapshotRecord[] = [];

        for (const member of members) {
            const user = (member as any).userId;
            if (!user || !user._id) continue;

            const userIdStr = user._id.toString();
            const attendance = attendanceMap.get(userIdStr);
            const onLeave = leaveSet.has(userIdStr);

            let status = 'ABSENT';
            if (onLeave) status = 'ON_LEAVE';
            else if (attendance) status = attendance.status || 'PRESENT';

            snapshotRecords.push({
                employeeId: userIdStr,
                name: user.name || 'Unknown',
                employeeName: user.name || 'Unknown',
                avatar: user.avatar || null,
                department: (member as any).designationId?.department || null,
                designation: (member as any).designationId?.name || null,
                date: targetDate,
                status,
                checkInTime: attendance?.checkInTime ? attendance.checkInTime.toISOString() : null,
                checkOutTime: attendance?.checkOutTime ? attendance.checkOutTime.toISOString() : null,
                workDurationMinutes: attendance?.totalWorkMinutes || 0,
                isLate: Boolean(
                    attendance?.isLate ||
                    attendance?.punchStatus === 'LATE' ||
                    (attendance?.metrics?.lateMinutes && attendance.metrics.lateMinutes > 0) ||
                    (attendance?.lateMinutes && attendance.lateMinutes > 0)
                ),
                lateDurationMinutes: attendance?.lateMinutes || 0,
                breakDurationMinutes: attendance?.totalBreakMinutes || 0,
            });
        }

        let filtered = snapshotRecords;
        if (params.status && params.status !== 'ALL') {
            filtered = filtered.filter((r) => r.status === params.status);
        }
        if (params.departmentId) {
            filtered = filtered.filter((r) => r.department === params.departmentId);
        }

        const total = filtered.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.pageSize || params.limit || 30));
        const skip = (page - 1) * limit;

        return {
            records: filtered.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }
}
export default LiveMonitoringService;
