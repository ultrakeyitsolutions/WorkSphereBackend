import { Types } from 'mongoose';
import {
    DetailedDateRangePreset,
    IDetailedEmployeeDirectoryItem,
    IDetailedEmployeeProfile,
    IDetailedEmployeeOverview,
    IDetailedAttendanceHistoryResponse,
    IDetailedAttendanceDayRecord,
    IDetailedEmployeeProjectItem,
    IDetailedEmployeeTaskItem,
    IDetailedMeetingItem,
    IDetailedTimelineEntry,
    IDetailedEmployeeAnalytics,
    DetailedReportType,
} from './detailed-monitoring.types';
import {
    PresenceStatus,
    EmployeeWorkStatus,
    AlertStatus,
    AlertType,
    AlertSeverity,
    IMonitoringAlertDto,
} from '../live-monitoring/live-monitoring.types';
import { EmployeePresenceService } from '../live-monitoring/services/employee-presence.service';
import { MonitoringAlertService } from '../live-monitoring/services/monitoring-alert.service';
import { MonitoringActivity } from '../live-monitoring/models/monitoring-activity.model';
import { MonitoringAlert } from '../live-monitoring/models/monitoring-alert.model';
import CompanyMember from '../invitations/company-member.model';
import Designation from '../invitations/designation/designation.model';
import CompanyRole from '../invitations/roles/company-role.model';
import User from '../../users/user.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../projects/project.model';
import { Task } from '../../tasks/task.model';
import { Status } from '../../tasks/status.model';
import { Stage } from '../../tasks/stage.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { AttendanceEvent } from '../../attendance/attendance-event.model';
import { AttendanceAdjustment } from '../../attendance/attendance-adjustment.model';
import { AttendanceEventType, LeaveStatus } from '../../attendance/attendance.types';
import LeaveRequest from '../../attendance/leave.model';
import { TimeTracking, TrackingState, IntervalType } from '../../task-tracking/time-tracking.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { Meeting } from '../../meetings/models/meeting.model';
import { MeetingParticipant } from '../../meetings/models/meeting-participant.model';
import { ParticipantResponseStatus } from '../../meetings/meeting.types';
import { AppError } from '../../../utils/AppError';

export class DetailedMonitoringService {
    /**
     * Helper: Resolve start and end Date objects from preset or custom strings
     */
    private static resolveDateRange(
        preset: DetailedDateRangePreset = 'TODAY',
        customStart?: string,
        customEnd?: string
    ): { startDate: Date; endDate: Date; startStr: string; endStr: string; preset: DetailedDateRangePreset } {
        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        if (preset === 'CUSTOM' && customStart && customEnd) {
            startDate = new Date(customStart);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
            return {
                startDate,
                endDate,
                startStr: startDate.toISOString().split('T')[0],
                endStr: endDate.toISOString().split('T')[0],
                preset: 'CUSTOM',
            };
        }

        switch (preset) {
            case 'YESTERDAY': {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
            case 'LAST_7_DAYS': {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 6);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
            case 'LAST_30_DAYS': {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 29);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
            case 'THIS_MONTH': {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
            case 'LAST_3_MONTHS': {
                startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
            case 'TODAY':
            default: {
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now);
                endDate.setHours(23, 59, 59, 999);
                break;
            }
        }

        return {
            startDate,
            endDate,
            startStr: startDate.toISOString().split('T')[0],
            endStr: endDate.toISOString().split('T')[0],
            preset,
        };
    }

    /**
     * ─── 1. Employee Directory & Selection ──────────────────────────────────────
     */
    public static async getEmployeeDirectory(
        companyId: string,
        params: {
            search?: string;
            departmentId?: string;
            roleId?: string;
            projectId?: string;
            presence?: PresenceStatus;
            attendanceStatus?: string;
            workStatus?: EmployeeWorkStatus;
            taskStatus?: string;
            sortBy?: 'lastActivity' | 'name' | 'status' | 'joinedAt' | 'alerts';
            sortOrder?: 'asc' | 'desc';
            page?: number;
            pageSize?: number;
            limit?: number;
        } = {}
    ): Promise<{ employees: IDetailedEmployeeDirectoryItem[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const todayStr = new Date().toISOString().split('T')[0];

        // 1. Fetch all presence records for the company
        const presenceRecords = await EmployeePresenceService.resolveCompanyEmployeesPresence(companyId, todayStr);
        const presenceMap = new Map<string, any>();
        presenceRecords.forEach((pr) => presenceMap.set(pr.employeeId, pr));

        // 2. Fetch company members with populated User, Designation, and Role
        const memberMatch: any = {
            companyId: companyObjId,
            status: { $ne: 'SUSPENDED' },
        };
        if (params.roleId && Types.ObjectId.isValid(params.roleId)) {
            memberMatch.roleId = new Types.ObjectId(params.roleId);
        }
        if (params.departmentId && Types.ObjectId.isValid(params.departmentId)) {
            memberMatch.designationId = new Types.ObjectId(params.departmentId);
        }

        const members = await CompanyMember.find(memberMatch)
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>(
                'userId',
                'name email avatar createdAt'
            )
            .populate<{ designationId: { _id: Types.ObjectId; name: string; department?: string } }>(
                'designationId',
                'name department'
            )
            .populate<{ roleId: { _id: Types.ObjectId; name: string } }>('roleId', 'name')
            .lean();

        if (!members.length) {
            return { employees: [], total: 0, page: 1, limit: params.pageSize || params.limit || 20 };
        }

        const userIds = members.filter((m: any) => m.userId && m.userId._id).map((m: any) => m.userId._id);

        // 3. Parallel fetch unresolved alerts counts, project leads/managers
        const [alertCounts, projectInCharges] = await Promise.all([
            MonitoringAlert.aggregate([
                {
                    $match: {
                        companyId: companyObjId,
                        status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                        resourceType: 'EMPLOYEE',
                        resourceId: { $in: userIds },
                    },
                },
                {
                    $group: {
                        _id: '$resourceId',
                        count: { $sum: 1 },
                    },
                },
            ]),
            ProjectInCharge.find()
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>(
                    'userId',
                    'name email avatar'
                )
                .lean(),
        ]);

        const alertCountMap = new Map<string, number>();
        alertCounts.forEach((ac: any) => alertCountMap.set(ac._id.toString(), ac.count));

        const managerMap = new Map<string, any>();
        projectInCharges.forEach((pic: any) => {
            if (pic.userId && pic.userId._id) {
                managerMap.set(pic.userId._id.toString(), {
                    id: pic.userId._id.toString(),
                    name: pic.userId.name,
                    email: pic.userId.email,
                    avatar: pic.userId.avatar || null,
                });
            }
        });

        // 4. Construct directory list
        let directory: IDetailedEmployeeDirectoryItem[] = [];

        for (const member of members) {
            const user = (member as any).userId;
            if (!user || !user._id) continue;

            const userIdStr = user._id.toString();
            const presence = presenceMap.get(userIdStr);
            const designation = (member as any).designationId;
            const role = (member as any).roleId;
            const alertsCount = alertCountMap.get(userIdStr) || 0;

            const item: IDetailedEmployeeDirectoryItem = {
                employeeId: userIdStr,
                userId: userIdStr,
                name: user.name || 'Unknown',
                email: user.email,
                avatar: user.avatar || null,
                employeeCode: (member as any).biometricId || null,
                designationId: designation?._id?.toString() || null,
                designationName: designation?.name || null,
                department: designation?.department || null,
                roleId: role?._id?.toString() || null,
                roleName: role?.name || null,
                manager: managerMap.get(userIdStr) || null,
                presenceStatus: presence?.presenceStatus || 'OFFLINE',
                workStatus: presence?.workStatus || 'OFFLINE',
                attendanceStatus: presence?.attendanceStatus || 'ABSENT',
                currentProject: presence?.currentTask?.projectId
                    ? {
                          id: presence.currentTask.projectId,
                          name: presence.currentTask.projectName || 'General',
                      }
                    : null,
                currentTask: presence?.currentTask
                    ? {
                          id: presence.currentTask.id || presence.currentTask.taskId,
                          taskId: presence.currentTask.taskId || presence.currentTask.id,
                          title: presence.currentTask.title || presence.currentTask.taskTitle,
                          taskTitle: presence.currentTask.taskTitle || presence.currentTask.title,
                          taskNumber: presence.currentTask.taskNumber,
                          status: presence.currentTask.status || presence.currentTask.taskStatus,
                          taskStatus: presence.currentTask.taskStatus || presence.currentTask.status,
                          priority: presence.currentTask.priority,
                          progress: presence.currentTask.progress,
                      }
                    : null,
                lastActivityTime: presence?.lastSeenAt || user.createdAt || null,
                unresolvedAlertsCount: alertsCount,
                joinedAt: (member as any).joinedAt || user.createdAt || null,
                status: (member as any).status || 'ACTIVE',
            };

            directory.push(item);
        }

        // 5. Apply filters
        if (params.search) {
            const query = params.search.toLowerCase();
            directory = directory.filter(
                (d) =>
                    d.name.toLowerCase().includes(query) ||
                    d.email.toLowerCase().includes(query) ||
                    (d.employeeCode && d.employeeCode.toLowerCase().includes(query)) ||
                    (d.designationName && d.designationName.toLowerCase().includes(query)) ||
                    (d.department && d.department.toLowerCase().includes(query))
            );
        }

        if (params.presence) {
            directory = directory.filter((d) => d.presenceStatus === params.presence);
        }

        if (params.attendanceStatus) {
            directory = directory.filter((d) => d.attendanceStatus === params.attendanceStatus);
        }

        if (params.workStatus) {
            directory = directory.filter((d) => d.workStatus === params.workStatus);
        }

        if (params.projectId) {
            directory = directory.filter((d) => d.currentProject?.id === params.projectId);
        }

        if (params.taskStatus) {
            directory = directory.filter(
                (d) =>
                    d.currentTask?.status === params.taskStatus || d.currentTask?.taskStatus === params.taskStatus
            );
        }

        // 6. Sorting
        const sortOrder = params.sortOrder === 'asc' ? 1 : -1;
        if (params.sortBy === 'name') {
            directory.sort((a, b) => a.name.localeCompare(b.name) * sortOrder);
        } else if (params.sortBy === 'status') {
            directory.sort((a, b) => a.workStatus.localeCompare(b.workStatus) * sortOrder);
        } else if (params.sortBy === 'joinedAt') {
            directory.sort((a, b) => {
                const dateA = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
                const dateB = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
                return (dateB - dateA) * (sortOrder === 1 ? -1 : 1);
            });
        } else if (params.sortBy === 'alerts') {
            directory.sort((a, b) => (b.unresolvedAlertsCount - a.unresolvedAlertsCount) * sortOrder);
        } else {
            // Default: lastActivity
            directory.sort((a, b) => {
                const dateA = a.lastActivityTime ? new Date(a.lastActivityTime).getTime() : 0;
                const dateB = b.lastActivityTime ? new Date(b.lastActivityTime).getTime() : 0;
                return (dateB - dateA) * (sortOrder === 1 ? -1 : 1);
            });
        }

        const total = directory.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.pageSize || params.limit || 20));
        const skip = (page - 1) * limit;

        return {
            employees: directory.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 2. Individual Employee Profile Header ──────────────────────────────────
     */
    public static async getEmployeeProfile(
        companyId: string,
        employeeId: string
    ): Promise<IDetailedEmployeeProfile> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const todayStr = new Date().toISOString().split('T')[0];

        // 1. Fetch company member record
        const member = await CompanyMember.findOne({
            companyId: companyObjId,
            userId: employeeObjId,
        })
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>(
                'userId',
                'name email avatar createdAt'
            )
            .populate<{ designationId: { _id: Types.ObjectId; name: string; department?: string } }>(
                'designationId',
                'name department'
            )
            .populate<{ roleId: { _id: Types.ObjectId; name: string } }>('roleId', 'name')
            .lean();

        if (!member || !member.userId) {
            throw AppError.notFound('Employee profile not found in this company');
        }

        const user = (member as any).userId;
        const designation = (member as any).designationId;
        const role = (member as any).roleId;

        // 2. Fetch presence details for today
        const [presenceRecords, unresolvedAlertsCount, projectInChargeDoc] = await Promise.all([
            EmployeePresenceService.resolveCompanyEmployeesPresence(companyId, todayStr),
            MonitoringAlert.countDocuments({
                companyId: companyObjId,
                status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                $or: [{ resourceId: employeeObjId }, { 'metadata.employeeId': employeeId }],
            }),
            ProjectInCharge.findOne({ userId: employeeObjId })
                .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>(
                    'userId',
                    'name email avatar'
                )
                .lean(),
        ]);

        const presence = presenceRecords.find((p) => p.employeeId === employeeId);
        const presenceStatus: PresenceStatus = presence?.presenceStatus || 'OFFLINE';
        const workStatus: EmployeeWorkStatus = presence?.workStatus || 'OFFLINE';
        const attendanceStatus = presence?.attendanceStatus || 'ABSENT';

        const isOnline = presenceStatus === 'ONLINE';
        const isCheckedIn = Boolean(presence?.checkInTime && !presence?.checkOutTime);
        const isOnBreak = workStatus === 'ON_BREAK';
        const isInMeeting = workStatus === 'IN_MEETING';
        const isOnLeave = workStatus === 'ON_LEAVE' || attendanceStatus === 'ON_LEAVE';

        return {
            employeeId,
            userId: employeeId,
            name: user.name || 'Unknown',
            email: user.email,
            avatar: user.avatar || null,
            phone: (user as any).phone || null,
            employeeCode: (member as any).biometricId || null,
            designation: designation
                ? {
                      id: designation._id.toString(),
                      name: designation.name,
                      department: designation.department || null,
                  }
                : null,
            department: designation?.department || null,
            role: role
                ? {
                      id: role._id.toString(),
                      name: role.name,
                  }
                : null,
            memberType: (member as any).memberType || 'EMPLOYEE',
            employmentStatus: (member as any).status || 'ACTIVE',
            joinedAt: (member as any).joinedAt || user.createdAt || null,
            biometricId: (member as any).biometricId || null,
            manager: projectInChargeDoc && projectInChargeDoc.userId
                ? {
                      id: projectInChargeDoc.userId._id.toString(),
                      name: (projectInChargeDoc.userId as any).name,
                      email: (projectInChargeDoc.userId as any).email,
                      avatar: (projectInChargeDoc.userId as any).avatar || null,
                  }
                : null,

            // Independent Status Dimensions
            presenceStatus,
            attendanceStatus,
            workStatus,
            isOnline,
            isCheckedIn,
            isOnBreak,
            isInMeeting,
            isOnLeave,

            // Current Work Context
            currentProject: presence?.currentTask?.projectId
                ? {
                      id: presence.currentTask.projectId,
                      name: presence.currentTask.projectName || 'General',
                  }
                : null,
            currentTask: presence?.currentTask
                ? {
                      id: presence.currentTask.id || presence.currentTask.taskId,
                      taskId: presence.currentTask.taskId || presence.currentTask.id,
                      title: presence.currentTask.title || presence.currentTask.taskTitle,
                      taskTitle: presence.currentTask.taskTitle || presence.currentTask.title,
                      taskNumber: presence.currentTask.taskNumber,
                      status: presence.currentTask.status || presence.currentTask.taskStatus,
                      taskStatus: presence.currentTask.taskStatus || presence.currentTask.status,
                      priority: presence.currentTask.priority,
                      progress: presence.currentTask.progress,
                  }
                : null,

            lastSeenAt: presence?.lastSeenAt || null,
            lastHeartbeatAt: presence?.lastHeartbeatAt || null,
            todayWorkMinutes: presence?.workDurationMinutes || 0,
            todayBreakMinutes: presence?.attendance?.isOnBreak ? 15 : 0,
            unresolvedAlertsCount,
        };
    }

    /**
     * ─── 3. Employee Overview Summary ───────────────────────────────────────────
     */
    public static async getEmployeeOverview(
        companyId: string,
        employeeId: string,
        params: {
            dateRange?: DetailedDateRangePreset;
            startDate?: string;
            endDate?: string;
        } = {}
    ): Promise<IDetailedEmployeeOverview> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const { startDate, endDate, startStr, endStr, preset } = this.resolveDateRange(
            params.dateRange,
            params.startDate,
            params.endDate
        );

        const todayStr = new Date().toISOString().split('T')[0];
        const now = new Date();

        // Run independent aggregations in parallel
        const [
            assignedProjectsCount,
            allTasks,
            periodCompletedTasksCount,
            todayAttendance,
            periodAttendances,
            periodTimeTrackings,
            meetingsAttendedCount,
            activeAlerts,
            recentActivities,
        ] = await Promise.all([
            // 1. Active assigned projects count
            ProjectTeamMember.countDocuments({ userId: employeeObjId }),

            // 2. Open / in-progress / overdue / blocked tasks for this employee
            Task.find({
                companyId: companyObjId,
                assignedToId: employeeObjId,
                isArchived: false,
                isActive: true,
            })
                .select('status progress deliveryDate stageId isReopen priority')
                .lean(),

            // 3. Completed tasks within selected period
            Task.countDocuments({
                companyId: companyObjId,
                assignedToId: employeeObjId,
                isArchived: false,
                $or: [{ status: 'COMPLETED' }, { progress: 100 }],
                updatedAt: { $gte: startDate, $lte: endDate },
            }),

            // 4. Today's attendance
            Attendance.findOne({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: todayStr,
            }).lean(),

            // 5. Attendance history for date range
            Attendance.find({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: { $gte: startStr, $lte: endStr },
            }).lean(),

            // 6. Time tracking records for date range
            TimeTracking.find({
                companyId: companyObjId,
                userId: employeeObjId,
                startedAt: { $gte: startDate, $lte: endDate },
            }).lean(),

            // 7. Meetings attended count in period
            MeetingParticipant.countDocuments({
                companyId: companyObjId,
                userId: employeeObjId,
                responseStatus: { $in: [ParticipantResponseStatus.ACCEPTED, 'ATTENDING', 'JOINED'] as any },
                createdAt: { $gte: startDate, $lte: endDate },
            }),

            // 8. Active alerts
            MonitoringAlert.find({
                companyId: companyObjId,
                status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
                $or: [{ resourceId: employeeObjId }, { 'metadata.employeeId': employeeId }],
            })
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),

            // 9. Recent activities
            MonitoringActivity.find({
                companyId: companyObjId,
                $or: [{ employeeId: employeeObjId }, { actorId: employeeObjId }],
            })
                .sort({ occurredAt: -1 })
                .limit(5)
                .lean(),
        ]);

        // Calculate Task status metrics
        let totalOpen = 0;
        let inProgress = 0;
        let overdue = 0;
        let blocked = 0;
        let awaitingReview = 0;

        for (const t of allTasks) {
            const isDone = (t as any).status === 'COMPLETED' || t.progress === 100;
            if (!isDone) {
                totalOpen++;
                if ((t as any).status === 'IN_PROGRESS' || ((t as any).progress && (t as any).progress > 0)) {
                    inProgress++;
                }
                if ((t as any).status === 'BLOCKED') {
                    blocked++;
                }
                if ((t as any).status === 'IN_REVIEW' || (t as any).status === 'REVIEW') {
                    awaitingReview++;
                }
                if ((t as any).deliveryDate && new Date((t as any).deliveryDate) < now) {
                    overdue++;
                }
            }
        }

        // Calculate Time tracking and attendance metrics
        let periodWorkedMinutes = 0;
        let periodBreakMinutes = 0;

        periodAttendances.forEach((a: any) => {
            periodWorkedMinutes += (a.actual?.workedMinutes || a.totalWorkMinutes || 0);
            periodBreakMinutes += (a.totalBreakMinutes || 0);
        });

        // If time tracking has more granular seconds, add them
        let timeTrackWorkedMinutes = 0;
        periodTimeTrackings.forEach((trk: any) => {
            timeTrackWorkedMinutes += Math.round((trk.workedSeconds || 0) / 60);
        });
        const finalPeriodWorkedMinutes = Math.max(periodWorkedMinutes, timeTrackWorkedMinutes);

        // Attendance stats
        let presentDays = 0;
        let absentDays = 0;
        let lateDays = 0;
        let halfDays = 0;
        let leaveDays = 0;
        let holidayDays = 0;

        periodAttendances.forEach((a: any) => {
            if (a.status === AttendanceStatus.PRESENT) presentDays++;
            else if (a.status === AttendanceStatus.ABSENT) absentDays++;
            else if (a.status === AttendanceStatus.HALF_DAY) halfDays++;
            else if (a.status === AttendanceStatus.LEAVE) leaveDays++;
            else if (a.status === AttendanceStatus.HOLIDAY) holidayDays++;

            if (a.isLate || a.punchStatus === 'LATE' || (a.metrics?.lateMinutes && a.metrics.lateMinutes > 0)) {
                lateDays++;
            }
        });

        // Productivity score: weighted formula of on-time delivery & attendance consistency
        const totalConsideredTasks = periodCompletedTasksCount + overdue;
        const taskScore = totalConsideredTasks > 0
            ? Math.round((periodCompletedTasksCount / totalConsideredTasks) * 100)
            : 85;
        const attendanceScore = periodAttendances.length > 0
            ? Math.round(((presentDays + halfDays * 0.5) / periodAttendances.length) * 100)
            : 90;
        const productivityScore = Math.min(100, Math.max(0, Math.round(taskScore * 0.6 + attendanceScore * 0.4)));

        return {
            employeeId,
            dateRange: {
                preset,
                startDate: startStr,
                endDate: endStr,
            },
            metrics: {
                activeAssignedProjectsCount: assignedProjectsCount,
                totalOpenTasksCount: totalOpen,
                tasksInProgressCount: inProgress,
                completedTasksCount: periodCompletedTasksCount,
                overdueTasksCount: overdue,
                blockedTasksCount: blocked,
                tasksAwaitingReviewCount: awaitingReview,
                todayWorkingDurationMinutes: todayAttendance?.actual?.workedMinutes || (todayAttendance as any)?.totalWorkMinutes || 0,
                todayBreakDurationMinutes: (todayAttendance as any)?.totalBreakMinutes || 0,
                periodWorkingDurationMinutes: finalPeriodWorkedMinutes,
                periodBreakDurationMinutes: periodBreakMinutes,
                meetingsAttendedCount,
                unresolvedAlertsCount: activeAlerts.length,
                productivityScore,
            },
            attendanceSummary: {
                totalDays: periodAttendances.length,
                presentDays,
                absentDays,
                lateDays,
                halfDays,
                leaveDays,
                holidayDays,
            },
            recentActivities: recentActivities.map((act) => ({
                id: (act as any)._id.toString(),
                eventType: act.eventType,
                summary: act.summary,
                occurredAt: act.occurredAt.toISOString(),
                projectName: act.projectName || undefined,
                taskTitle: act.taskTitle || undefined,
            })),
            activeAlerts: activeAlerts.map((alt) => ({
                id: (alt as any)._id.toString(),
                companyId: alt.companyId.toString(),
                alertType: alt.alertType,
                severity: alt.severity,
                title: alt.title,
                summary: alt.summary,
                resourceType: alt.resourceType,
                resourceId: alt.resourceId ? alt.resourceId.toString() : undefined,
                status: alt.status,
                acknowledgedAt: alt.acknowledgedAt || null,
                resolvedAt: alt.resolvedAt || null,
                createdAt: alt.createdAt,
                metadata: alt.metadata,
            })),
        };
    }

    /**
     * ─── 4. Attendance and Time Tracking History ────────────────────────────────
     */
    public static async getEmployeeAttendanceHistory(
        companyId: string,
        employeeId: string,
        params: {
            startDate?: string;
            endDate?: string;
            month?: string;
            year?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<IDetailedAttendanceHistoryResponse> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        let startStr: string;
        let endStr: string;

        if (params.startDate && params.endDate) {
            startStr = params.startDate;
            endStr = params.endDate;
        } else if (params.month && params.year) {
            const m = parseInt(params.month, 10);
            const y = parseInt(params.year, 10);
            const firstDay = new Date(y, m - 1, 1);
            const lastDay = new Date(y, m, 0);
            startStr = firstDay.toISOString().split('T')[0];
            endStr = lastDay.toISOString().split('T')[0];
        } else {
            // Default: last 30 days
            const now = new Date();
            const past = new Date(now);
            past.setDate(past.getDate() - 29);
            startStr = past.toISOString().split('T')[0];
            endStr = now.toISOString().split('T')[0];
        }

        const [attendances, adjustments, breakEvents, timeTrackings] = await Promise.all([
            Attendance.find({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: { $gte: startStr, $lte: endStr },
            })
                .populate('shiftId', 'name startTime endTime')
                .populate('leave.leaveId', 'leaveType durationType reason')
                .sort({ date: -1 })
                .lean(),

            AttendanceAdjustment.find({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: { $gte: startStr, $lte: endStr },
            })
                .populate<{ approvedBy: { _id: Types.ObjectId; name: string } }>('approvedBy', 'name')
                .sort({ createdAt: -1 })
                .lean(),

            AttendanceEvent.find({
                companyId: companyObjId,
                employeeId: employeeObjId,
                type: { $in: [AttendanceEventType.BREAK_START, AttendanceEventType.BREAK_END] },
            })
                .sort({ timestamp: 1 })
                .lean(),

            TimeTracking.find({
                companyId: companyObjId,
                userId: employeeObjId,
                startedAt: { $gte: new Date(startStr), $lte: new Date(`${endStr}T23:59:59.999Z`) },
            })
                .populate<{ taskId: { _id: Types.ObjectId; title: string; taskNumber?: string } }>('taskId', 'title taskNumber')
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .sort({ startedAt: 1 })
                .lean(),
        ]);

        // Map adjustments by date
        const adjustmentMap = new Map<string, any[]>();
        adjustments.forEach((adj: any) => {
            const list = adjustmentMap.get(adj.date) || [];
            list.push({
                adjustmentId: adj._id.toString(),
                date: adj.date,
                status: adj.status,
                reason: adj.reason,
                requestedValues: adj.requestedValues || {},
                approvedBy: adj.approvedBy
                    ? { id: adj.approvedBy._id.toString(), name: adj.approvedBy.name }
                    : null,
                approvedAt: adj.approvedAt ? adj.approvedAt.toISOString() : null,
                rejectionReason: adj.rejectionReason || null,
            });
            adjustmentMap.set(adj.date, list);
        });

        // Map time tracking sessions by date
        const workSessionMap = new Map<string, any[]>();
        timeTrackings.forEach((trk: any) => {
            const dateStr = new Date(trk.startedAt).toISOString().split('T')[0];
            const list = workSessionMap.get(dateStr) || [];
            const durMin = Math.round((trk.workedSeconds || 0) / 60);
            list.push({
                sessionId: trk._id.toString(),
                startTime: trk.startedAt,
                endTime: trk.endedAt || null,
                durationMinutes: durMin,
                taskId: trk.taskId?._id?.toString() || undefined,
                taskTitle: trk.taskId?.title || undefined,
                taskNumber: trk.taskId?.taskNumber || undefined,
                projectId: trk.projectId?._id?.toString() || undefined,
                projectName: trk.projectId?.name || undefined,
            });
            workSessionMap.set(dateStr, list);
        });

        // Aggregate summary metrics
        let totalScheduledMinutes = 0;
        let totalWorkedMinutes = 0;
        let totalBreakMinutes = 0;
        let totalOvertimeMinutes = 0;
        let totalLateMinutes = 0;
        let presentDays = 0;
        let absentDays = 0;
        let lateDays = 0;
        let halfDays = 0;
        let leaveDays = 0;
        let holidayDays = 0;
        let missingCheckoutsCount = 0;

        const dayRecords: IDetailedAttendanceDayRecord[] = [];

        for (const att of attendances) {
            const dateKey = att.date;
            const scheduledMin = att.scheduled?.workingMinutes || 480;
            const workedMin = att.actual?.workedMinutes || (att as any).totalWorkMinutes || 0;
            const breakMin = (att as any).totalBreakMinutes || 0;
            const lateMin = att.metrics?.lateMinutes || (att as any).lateMinutes || 0;
            const earlyLeaveMin = att.metrics?.earlyLeaveMinutes || 0;
            const overtimeMin = att.metrics?.overtimeMinutes || 0;

            const isLate = Boolean(att.isLate || att.punchStatus === 'LATE' || lateMin > 0);
            const isEarlyLeave = earlyLeaveMin > 0;
            const isOvertime = overtimeMin > 0;
            const isMissingCheckOut = Boolean(att.actual?.firstCheckIn && !att.actual?.lastCheckOut && att.status === AttendanceStatus.PRESENT);

            totalScheduledMinutes += scheduledMin;
            totalWorkedMinutes += workedMin;
            totalBreakMinutes += breakMin;
            totalOvertimeMinutes += overtimeMin;
            totalLateMinutes += lateMin;

            if (att.status === AttendanceStatus.PRESENT) presentDays++;
            else if (att.status === AttendanceStatus.ABSENT) absentDays++;
            else if (att.status === AttendanceStatus.HALF_DAY) halfDays++;
            else if (att.status === AttendanceStatus.LEAVE) leaveDays++;
            else if (att.status === AttendanceStatus.HOLIDAY) holidayDays++;

            if (isLate) lateDays++;
            if (isMissingCheckOut) missingCheckoutsCount++;

            // Shift info
            const shiftDoc = att.shiftId as any;
            const shiftInfo = shiftDoc
                ? {
                      id: shiftDoc._id.toString(),
                      name: shiftDoc.name,
                      startTime: shiftDoc.startTime,
                      endTime: shiftDoc.endTime,
                  }
                : null;

            // Leave info
            const leaveDoc = att.leave?.leaveId as any;
            const leaveInfo = leaveDoc
                ? {
                      leaveId: leaveDoc._id.toString(),
                      leaveType: leaveDoc.leaveType || att.leave?.leaveType || 'LEAVE',
                      durationType: leaveDoc.durationType || att.leave?.durationType || 'FULL_DAY',
                  }
                : null;

            dayRecords.push({
                date: att.date,
                status: att.status,
                punchStatus: att.punchStatus || (isLate ? 'LATE' : 'ON_TIME'),
                checkInTime: att.actual?.firstCheckIn ? att.actual.firstCheckIn.toISOString() : (att as any).checkInTime ? new Date((att as any).checkInTime).toISOString() : null,
                checkOutTime: att.actual?.lastCheckOut ? att.actual.lastCheckOut.toISOString() : (att as any).checkOutTime ? new Date((att as any).checkOutTime).toISOString() : null,
                scheduled: {
                    startTime: att.scheduled?.startTime || null,
                    endTime: att.scheduled?.endTime || null,
                    workingMinutes: scheduledMin,
                },
                actual: {
                    firstCheckIn: att.actual?.firstCheckIn || null,
                    lastCheckOut: att.actual?.lastCheckOut || null,
                    workedMinutes: workedMin,
                },
                metrics: {
                    lateMinutes: lateMin,
                    earlyLeaveMinutes: earlyLeaveMin,
                    overtimeMinutes: overtimeMin,
                },
                breakDurationMinutes: breakMin,
                breaks: [], // granular breaks if recorded
                workSessions: workSessionMap.get(dateKey) || [],
                isLate,
                isEarlyLeave,
                isOvertime,
                isMissingCheckOut,
                shift: shiftInfo,
                leave: leaveInfo,
                holiday: att.holiday
                    ? {
                          holidayId: att.holiday.holidayId ? att.holiday.holidayId.toString() : '',
                          holidayName: att.holiday.holidayName || 'Holiday',
                      }
                    : null,
                adjustments: adjustmentMap.get(dateKey) || [],
            });
        }

        const total = dayRecords.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 31));
        const skip = (page - 1) * limit;

        const averageDailyWorkedHours = total > 0 ? Number(((totalWorkedMinutes / 60) / total).toFixed(1)) : 0;

        return {
            records: dayRecords.slice(skip, skip + limit),
            summary: {
                totalScheduledHours: Number((totalScheduledMinutes / 60).toFixed(1)),
                totalWorkedHours: Number((totalWorkedMinutes / 60).toFixed(1)),
                totalBreakHours: Number((totalBreakMinutes / 60).toFixed(1)),
                totalOvertimeHours: Number((totalOvertimeMinutes / 60).toFixed(1)),
                totalLateMinutes,
                presentDays,
                absentDays,
                lateDays,
                halfDays,
                leaveDays,
                holidayDays,
                missingCheckoutsCount,
                averageDailyWorkedHours,
            },
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 5. All Projects Assigned to Employee ───────────────────────────────────
     */
    public static async getEmployeeProjects(
        companyId: string,
        employeeId: string,
        params: {
            status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'ON_HOLD' | 'ALL';
            search?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ projects: IDetailedEmployeeProjectItem[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const now = new Date();

        // 1. Find all project memberships for this user
        const [teamMemberships, inChargeDocs] = await Promise.all([
            ProjectTeamMember.find({ userId: employeeObjId }).lean(),
            ProjectInCharge.find({ userId: employeeObjId }).lean(),
        ]);

        const inChargeProjectIds = new Set(inChargeDocs.map((ic) => ic.projectId.toString()));
        const allProjectIds = Array.from(
            new Set([...teamMemberships.map((tm) => tm.projectId.toString()), ...Array.from(inChargeProjectIds)])
        ).map((id) => new Types.ObjectId(id));

        if (!allProjectIds.length) {
            return { projects: [], total: 0, page: 1, limit: params.limit || 20 };
        }

        const projectFilter: any = {
            _id: { $in: allProjectIds },
            companyId: companyObjId,
        };

        if (params.status && params.status !== 'ALL') {
            projectFilter.status = params.status;
        }
        if (params.search) {
            projectFilter.name = { $regex: params.search, $options: 'i' };
        }

        const projects = await Project.find(projectFilter)
            .populate<{ createdById: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>(
                'createdById',
                'name email avatar'
            )
            .sort({ updatedAt: -1 })
            .lean();

        const projectItems: IDetailedEmployeeProjectItem[] = [];

        for (const proj of projects) {
            const projId = (proj as any)._id;

            // Fetch tasks assigned to this employee in this project
            const [tasks, timeTrackings, recentActivities] = await Promise.all([
                Task.find({
                    companyId: companyObjId,
                    projectId: projId,
                    assignedToId: employeeObjId,
                    isArchived: false,
                    isActive: true,
                })
                    .select('status progress deliveryDate estimatedTime')
                    .lean(),

                TimeTracking.find({
                    companyId: companyObjId,
                    projectId: projId,
                    userId: employeeObjId,
                })
                    .select('workedSeconds')
                    .lean(),

                MonitoringActivity.find({
                    companyId: companyObjId,
                    projectId: projId,
                    employeeId: employeeObjId,
                })
                    .sort({ occurredAt: -1 })
                    .limit(3)
                    .lean(),
            ]);

            const totalTasks = tasks.length;
            const completedTasks = tasks.filter((t: any) => t.status === 'COMPLETED' || t.progress === 100).length;
            const overdueTasks = tasks.filter(
                (t: any) => t.status !== 'COMPLETED' && t.deliveryDate && new Date(t.deliveryDate) < now
            ).length;
            const blockedTasks = tasks.filter((t: any) => t.status === 'BLOCKED').length;
            const inProgressTasks = totalTasks - completedTasks;
            const recordedProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

            let trackedTimeSeconds = 0;
            timeTrackings.forEach((trk) => {
                trackedTimeSeconds += (trk as any).workedSeconds || 0;
            });

            let estimatedHours = 0;
            tasks.forEach((t: any) => {
                const h = t.estimatedTime?.hours || 0;
                const m = t.estimatedTime?.minutes || 0;
                estimatedHours += h + m / 60;
            });

            const isLead = inChargeProjectIds.has(projId.toString());

            projectItems.push({
                projectId: projId.toString(),
                name: (proj as any).name,
                description: (proj as any).description || null,
                type: (proj as any).type,
                priority: (proj as any).priority,
                status: (proj as any).status,
                startDate: (proj as any).startDate || null,
                endDate: (proj as any).endDate || null,
                actualEndDate: (proj as any).actualEndDate || null,
                manager: (proj as any).createdById
                    ? {
                          id: (proj as any).createdById._id.toString(),
                          name: (proj as any).createdById.name,
                          email: (proj as any).createdById.email,
                          avatar: (proj as any).createdById.avatar || null,
                      }
                    : null,
                employeeRole: isLead ? 'IN_CHARGE' : 'TEAM_MEMBER',
                recordedProgress,
                totalTasks,
                completedTasks,
                inProgressTasks,
                blockedTasks,
                overdueTasks,
                trackedTimeSeconds,
                estimatedHours: Number(estimatedHours.toFixed(1)),
                recentActivity: recentActivities.map((act) => ({
                    summary: act.summary,
                    occurredAt: act.occurredAt.toISOString(),
                })),
            });
        }

        const total = projectItems.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 20));
        const skip = (page - 1) * limit;

        return {
            projects: projectItems.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 6. All Tasks and Task History ──────────────────────────────────────────
     */
    public static async getEmployeeTasks(
        companyId: string,
        employeeId: string,
        params: {
            status?: string;
            priority?: string;
            projectId?: string;
            sprintId?: string;
            isBlocked?: boolean;
            isOverdue?: boolean;
            startDate?: string;
            endDate?: string;
            search?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ tasks: IDetailedEmployeeTaskItem[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const now = new Date();

        const filter: any = {
            companyId: companyObjId,
            assignedToId: employeeObjId,
            isArchived: false,
            isActive: true,
        };

        if (params.projectId && Types.ObjectId.isValid(params.projectId)) {
            filter.projectId = new Types.ObjectId(params.projectId);
        }
        if (params.sprintId && Types.ObjectId.isValid(params.sprintId)) {
            filter.sprintId = new Types.ObjectId(params.sprintId);
        }
        if (params.priority) {
            filter.priority = params.priority;
        }
        if (params.search) {
            filter.$or = [
                { title: { $regex: params.search, $options: 'i' } },
                { taskNumber: { $regex: params.search, $options: 'i' } },
            ];
        }
        if (params.startDate || params.endDate) {
            filter.createdAt = {};
            if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
            if (params.endDate) filter.createdAt.$lte = new Date(`${params.endDate}T23:59:59.999Z`);
        }

        const sort: any = {};
        const sortField = params.sortBy || 'updatedAt';
        sort[sortField] = params.sortOrder === 'asc' ? 1 : -1;

        const tasks = await Task.find(filter)
            .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
            .populate<{ sprintId: { _id: Types.ObjectId; name: string } }>('sprintId', 'name')
            .populate<{ releaseId: { _id: Types.ObjectId; name: string } }>('releaseId', 'name')
            .populate<{ statusId: { _id: Types.ObjectId; name: string; color: string } }>('statusId', 'name color')
            .populate<{ stageId: { _id: Types.ObjectId; name: string } }>('stageId', 'name')
            .sort(sort)
            .lean();

        const taskIds = tasks.map((t) => t._id);

        // Fetch task activities and time trackings in bulk
        const [activities, timeTrackings] = await Promise.all([
            TaskActivity.find({ taskId: { $in: taskIds } })
                .populate<{ userId: { _id: Types.ObjectId; name: string } }>('userId', 'name')
                .sort({ createdAt: -1 })
                .lean(),
            TimeTracking.find({ taskId: { $in: taskIds }, userId: employeeObjId })
                .select('taskId workedSeconds')
                .lean(),
        ]);

        const activityMap = new Map<string, any[]>();
        activities.forEach((act: any) => {
            const tid = act.taskId.toString();
            const list = activityMap.get(tid) || [];
            if (list.length < 5) {
                list.push({
                    type: act.type,
                    content: act.content,
                    createdAt: act.createdAt.toISOString(),
                    userName: act.userId?.name || 'System',
                });
            }
            activityMap.set(tid, list);
        });

        const timeTrackMap = new Map<string, number>();
        timeTrackings.forEach((trk: any) => {
            const tid = trk.taskId.toString();
            const prev = timeTrackMap.get(tid) || 0;
            timeTrackMap.set(tid, prev + (trk.workedSeconds || 0));
        });

        let taskItems: IDetailedEmployeeTaskItem[] = [];

        for (const t of tasks) {
            const tid = (t as any)._id.toString();
            const isOverdue = Boolean(
                (t as any).status !== 'COMPLETED' && (t as any).deliveryDate && new Date((t as any).deliveryDate) < now
            );
            const isBlocked = (t as any).status === 'BLOCKED';
            const statusName = (t as any).statusId?.name || (t as any).status || 'TODO';
            const statusColor = (t as any).statusId?.color || '#6B7280';
            const stageName = (t as any).stageId?.name || null;
            const commentsCount = (t as any).notes?.length || 0;
            const attachmentsCount = (t as any).attachments?.length || 0;

            const checklist = (t as any).checklist || [];
            const completedChecklist = checklist.filter((c: any) => c.isCompleted).length;

            const trackedSeconds = timeTrackMap.get(tid) || 0;
            const actualHours = (t as any).actualHours || Number((trackedSeconds / 3600).toFixed(1));

            const item: IDetailedEmployeeTaskItem = {
                taskId: tid,
                taskNumber: (t as any).taskNumber,
                itemNumber: (t as any).itemNumber,
                title: (t as any).title,
                notes: ((t as any).notes || []).map((n: any) => n.content),
                project: {
                    id: (t as any).projectId?._id?.toString() || '',
                    name: (t as any).projectId?.name || 'General',
                },
                sprint: (t as any).sprintId
                    ? { id: (t as any).sprintId._id.toString(), name: (t as any).sprintId.name }
                    : null,
                release: (t as any).releaseId
                    ? { id: (t as any).releaseId._id.toString(), name: (t as any).releaseId.name }
                    : null,
                priority: (t as any).priority || 'MEDIUM',
                status: statusName,
                statusColor,
                stage: stageName,
                criticality: (t as any).criticality || 'NON_CRITICAL',
                startDate: (t as any).startDate || null,
                endDate: (t as any).endDate || null,
                dueDate: (t as any).dueDate || null,
                deliveryDate: (t as any).deliveryDate || null,
                completedDate: (t as any).completedDate || null,
                isOverdue,
                progress: (t as any).progress || 0,
                estimatedTime: (t as any).estimatedTime || { hours: 0, minutes: 0 },
                actualHours,
                actualTrackedSeconds: trackedSeconds,
                isBlocked,
                blockerReason: (t as any).reopenReason || null,
                reviewStatus: statusName === 'IN_REVIEW' ? 'PENDING' : 'NONE',
                commentsCount,
                attachmentsCount,
                checklistProgress: {
                    total: checklist.length,
                    completed: completedChecklist,
                },
                reopenHistory: (t as any).isReopen
                    ? {
                          isReopen: true,
                          reopenedFromTaskNumber: (t as any).reopenedFromTaskNumber || null,
                          reopenReason: (t as any).reopenReason || null,
                      }
                    : null,
                activityTimeline: activityMap.get(tid) || [],
            };

            taskItems.push(item);
        }

        // Filter flags
        if (params.isBlocked !== undefined) {
            taskItems = taskItems.filter((t) => t.isBlocked === params.isBlocked);
        }
        if (params.isOverdue !== undefined) {
            taskItems = taskItems.filter((t) => t.isOverdue === params.isOverdue);
        }
        if (params.status) {
            taskItems = taskItems.filter((t) => t.status.toLowerCase() === params.status!.toLowerCase());
        }

        const total = taskItems.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 20));
        const skip = (page - 1) * limit;

        return {
            tasks: taskItems.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 7. Meeting Participation History ───────────────────────────────────────
     */
    public static async getEmployeeMeetings(
        companyId: string,
        employeeId: string,
        params: {
            status?: string;
            from?: string;
            to?: string;
            search?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ meetings: IDetailedMeetingItem[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        // Find all meeting participant records for this employee
        const participantDocs = await MeetingParticipant.find({
            companyId: companyObjId,
            userId: employeeObjId,
        }).lean();

        const meetingIds = participantDocs.map((p) => p.meetingId);
        if (!meetingIds.length) {
            return { meetings: [], total: 0, page: 1, limit: params.limit || 20 };
        }

        const filter: any = {
            _id: { $in: meetingIds },
            companyId: companyObjId,
        };

        if (params.status) {
            filter.status = params.status;
        }
        if (params.from || params.to) {
            filter.scheduledStartAt = {};
            if (params.from) filter.scheduledStartAt.$gte = new Date(params.from);
            if (params.to) filter.scheduledStartAt.$lte = new Date(params.to);
        }
        if (params.search) {
            filter.title = { $regex: params.search, $options: 'i' };
        }

        const meetings = await Meeting.find(filter)
            .populate<{ organizerId: { _id: Types.ObjectId; name: string; avatar?: string } }>('organizerId', 'name avatar')
            .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
            .populate<{ taskId: { _id: Types.ObjectId; title: string } }>('taskId', 'title')
            .sort({ scheduledStartAt: -1 })
            .lean();

        const participantMap = new Map<string, any>();
        participantDocs.forEach((p) => participantMap.set(p.meetingId.toString(), p));

        const meetingItems: IDetailedMeetingItem[] = [];

        for (const m of meetings) {
            const mid = (m as any)._id.toString();
            const part = participantMap.get(mid);

            const joinedAt = part?.joinedAt || null;
            const leftAt = part?.leftAt || null;
            let durationMinutes = 0;
            if (joinedAt && leftAt) {
                durationMinutes = Math.round((new Date(leftAt).getTime() - new Date(joinedAt).getTime()) / 60000);
            } else if (joinedAt) {
                durationMinutes = (m as any).durationMinutes || 30;
            }

            meetingItems.push({
                meetingId: mid,
                title: (m as any).title,
                agenda: (m as any).agenda,
                description: (m as any).description || null,
                meetingType: (m as any).meetingType,
                meetingLink: (m as any).meetingLink || null,
                organizer: {
                    id: (m as any).organizerId?._id?.toString() || '',
                    name: (m as any).organizerId?.name || 'Organizer',
                    avatar: (m as any).organizerId?.avatar || null,
                },
                project: (m as any).projectId
                    ? { id: (m as any).projectId._id.toString(), name: (m as any).projectId.name }
                    : null,
                task: (m as any).taskId
                    ? { id: (m as any).taskId._id.toString(), title: (m as any).taskId.title }
                    : null,
                scheduledStartAt: (m as any).scheduledStartAt,
                scheduledEndAt: (m as any).scheduledEndAt,
                durationMinutes: (m as any).durationMinutes || 30,
                actualStartAt: (m as any).actualStartAt || null,
                actualEndAt: (m as any).actualEndAt || null,
                invitationStatus: part?.responseStatus || 'PENDING',
                participation: {
                    joinedAt,
                    leftAt,
                    durationMinutes,
                    didAttend: Boolean(joinedAt || part?.responseStatus === 'ATTENDING' || part?.responseStatus === 'JOINED'),
                    rescheduleReason: part?.rescheduleReason || null,
                    declineReason: part?.declineReason || null,
                },
                status: (m as any).status,
            });
        }

        const total = meetingItems.length;
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 20));
        const skip = (page - 1) * limit;

        return {
            meetings: meetingItems.slice(skip, skip + limit),
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 8. Complete Employee Activity Timeline ─────────────────────────────────
     */
    public static async getEmployeeTimeline(
        companyId: string,
        employeeId: string,
        params: {
            eventType?: string;
            projectId?: string;
            taskId?: string;
            from?: string;
            to?: string;
            cursor?: string;
            limit?: number;
        } = {}
    ): Promise<{ items: IDetailedTimelineEntry[]; nextCursor: string | null; hasMore: boolean }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const limit = Math.min(100, Math.max(1, params.limit || 30));

        const filter: any = {
            companyId: companyObjId,
            $or: [{ employeeId: employeeObjId }, { actorId: employeeObjId }],
        };

        if (params.eventType) filter.eventType = params.eventType;
        if (params.projectId && Types.ObjectId.isValid(params.projectId)) {
            filter.projectId = new Types.ObjectId(params.projectId);
        }
        if (params.taskId && Types.ObjectId.isValid(params.taskId)) {
            filter.taskId = new Types.ObjectId(params.taskId);
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

        const timelineEntries: IDetailedTimelineEntry[] = items.map((act) => ({
            id: (act as any)._id.toString(),
            eventId: act.eventId,
            sequence: act.sequence,
            eventType: act.eventType,
            source: 'MONITORING_ACTIVITY',
            actor: {
                userId: act.actorId ? act.actorId.toString() : undefined,
                displayName: act.actorName || 'System',
                avatar: act.actorAvatar || undefined,
            },
            summary: act.summary,
            description: act.summary,
            occurredAt: act.occurredAt.toISOString(),
            project: act.projectId
                ? { id: act.projectId.toString(), name: act.projectName || 'General' }
                : null,
            task: act.taskId
                ? { id: act.taskId.toString(), title: act.taskTitle || 'Task' }
                : null,
            meeting: act.meetingId ? { id: act.meetingId.toString(), title: 'Meeting' } : null,
            metadata: act.metadata || {},
        }));

        return {
            items: timelineEntries,
            nextCursor: hasMore ? nextCursor : null,
            hasMore,
        };
    }

    /**
     * ─── 9. Workload and Productivity Analytics ─────────────────────────────────
     */
    public static async getEmployeeAnalytics(
        companyId: string,
        employeeId: string,
        params: {
            dateRange?: DetailedDateRangePreset;
            startDate?: string;
            endDate?: string;
        } = {}
    ): Promise<IDetailedEmployeeAnalytics> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const { startDate, endDate, startStr, endStr, preset } = this.resolveDateRange(
            params.dateRange || 'LAST_30_DAYS',
            params.startDate,
            params.endDate
        );

        const now = new Date();

        // 1. Parallel queries for tasks, attendances, time tracking, meetings
        const [tasks, attendances, timeTrackings, meetings] = await Promise.all([
            Task.find({
                companyId: companyObjId,
                assignedToId: employeeObjId,
                isArchived: false,
                isActive: true,
            })
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            Attendance.find({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: { $gte: startStr, $lte: endStr },
            }).lean(),

            TimeTracking.find({
                companyId: companyObjId,
                userId: employeeObjId,
                startedAt: { $gte: startDate, $lte: endDate },
            })
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            MeetingParticipant.find({
                companyId: companyObjId,
                userId: employeeObjId,
                createdAt: { $gte: startDate, $lte: endDate },
            })
                .populate<{ meetingId: { _id: Types.ObjectId; durationMinutes: number } }>('meetingId', 'durationMinutes')
                .lean(),
        ]);

        // Task breakdown
        let assigned = tasks.length;
        let completed = 0;
        let inProgress = 0;
        let overdue = 0;
        let blocked = 0;
        let awaitingReview = 0;
        let totalEstimatedHours = 0;
        let onTimeCompletions = 0;

        for (const t of tasks) {
            const isDone = (t as any).status === 'COMPLETED' || t.progress === 100;
            const h = (t as any).estimatedTime?.hours || 0;
            const m = (t as any).estimatedTime?.minutes || 0;
            totalEstimatedHours += h + m / 60;

            if (isDone) {
                completed++;
                const completedDate = (t as any).completedDate || (t as any).updatedAt;
                if ((t as any).deliveryDate && completedDate && new Date(completedDate) <= new Date((t as any).deliveryDate)) {
                    onTimeCompletions++;
                } else if (!(t as any).deliveryDate) {
                    onTimeCompletions++;
                }
            } else {
                if ((t as any).status === 'IN_PROGRESS' || ((t as any).progress && (t as any).progress > 0)) inProgress++;
                if ((t as any).status === 'BLOCKED') blocked++;
                if ((t as any).status === 'IN_REVIEW') awaitingReview++;
                if ((t as any).deliveryDate && new Date((t as any).deliveryDate) < now) overdue++;
            }
        }

        const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
        const onTimeCompletionRate = completed > 0 ? Math.round((onTimeCompletions / completed) * 100) : 100;

        // Project workload distribution
        const projectTimeMap = new Map<string, { name: string; seconds: number; tasks: number; completed: number }>();
        let totalTrackedSeconds = 0;

        timeTrackings.forEach((trk: any) => {
            const pid = trk.projectId?._id?.toString() || 'unknown';
            const pname = trk.projectId?.name || 'General';
            const secs = trk.workedSeconds || 0;
            totalTrackedSeconds += secs;

            const existing = projectTimeMap.get(pid) || { name: pname, seconds: 0, tasks: 0, completed: 0 };
            existing.seconds += secs;
            projectTimeMap.set(pid, existing);
        });

        tasks.forEach((t: any) => {
            const pid = t.projectId?._id?.toString() || 'unknown';
            const pname = t.projectId?.name || 'General';
            const existing = projectTimeMap.get(pid) || { name: pname, seconds: 0, tasks: 0, completed: 0 };
            existing.tasks++;
            if (t.status === 'COMPLETED' || t.progress === 100) existing.completed++;
            projectTimeMap.set(pid, existing);
        });

        const projectWorkload = Array.from(projectTimeMap.entries()).map(([pid, val]) => ({
            projectId: pid,
            projectName: val.name,
            tasksCount: val.tasks,
            completedTasksCount: val.completed,
            trackedMinutes: Math.round(val.seconds / 60),
            percentageOfTotalTime:
                totalTrackedSeconds > 0 ? Math.round((val.seconds / totalTrackedSeconds) * 100) : 0,
        }));

        // Daily Trends Map
        const dailyTrendsMap = new Map<string, { tasksCompleted: number; tasksAssigned: number; trackedMinutes: number; breakMinutes: number; meetingMinutes: number }>();

        // Populate days in range
        const curDate = new Date(startDate);
        while (curDate <= endDate) {
            const dStr = curDate.toISOString().split('T')[0];
            dailyTrendsMap.set(dStr, { tasksCompleted: 0, tasksAssigned: 0, trackedMinutes: 0, breakMinutes: 0, meetingMinutes: 0 });
            curDate.setDate(curDate.getDate() + 1);
        }

        attendances.forEach((att: any) => {
            const dStr = att.date;
            const entry = dailyTrendsMap.get(dStr);
            if (entry) {
                entry.trackedMinutes += att.actual?.workedMinutes || (att as any).totalWorkMinutes || 0;
                entry.breakMinutes += (att as any).totalBreakMinutes || 0;
            }
        });

        tasks.forEach((t: any) => {
            const createdStr = new Date(t.createdAt).toISOString().split('T')[0];
            const entryCreated = dailyTrendsMap.get(createdStr);
            if (entryCreated) entryCreated.tasksAssigned++;

            if (t.status === 'COMPLETED' || t.progress === 100) {
                const compStr = new Date(t.updatedAt).toISOString().split('T')[0];
                const entryComp = dailyTrendsMap.get(compStr);
                if (entryComp) entryComp.tasksCompleted++;
            }
        });

        const dailyTrends = Array.from(dailyTrendsMap.entries()).map(([date, val]) => ({
            date,
            tasksCompleted: val.tasksCompleted,
            tasksAssigned: val.tasksAssigned,
            trackedMinutes: val.trackedMinutes,
            breakMinutes: val.breakMinutes,
            meetingMinutes: val.meetingMinutes,
        }));

        // Attendance stats
        let presentDays = 0;
        let absentDays = 0;
        let lateDays = 0;
        let halfDays = 0;
        let leaveDays = 0;
        let totalWorkedMinutes = 0;
        let totalOvertimeHours = 0;

        attendances.forEach((a: any) => {
            if (a.status === AttendanceStatus.PRESENT) presentDays++;
            else if (a.status === AttendanceStatus.ABSENT) absentDays++;
            else if (a.status === AttendanceStatus.HALF_DAY) halfDays++;
            else if (a.status === AttendanceStatus.LEAVE) leaveDays++;

            if (a.isLate || a.punchStatus === 'LATE' || (a.metrics?.lateMinutes && a.metrics.lateMinutes > 0)) {
                lateDays++;
            }
            totalWorkedMinutes += (a.actual?.workedMinutes || (a as any).totalWorkMinutes || 0);
            totalOvertimeHours += ((a.metrics?.overtimeMinutes || 0) / 60);
        });

        const averageWorkHoursPerDay = attendances.length > 0
            ? Number(((totalWorkedMinutes / 60) / attendances.length).toFixed(1))
            : 0;

        // Meeting metrics
        let totalAttendedMeetings = 0;
        let totalMeetingMinutes = 0;

        meetings.forEach((m: any) => {
            const didAttend = m.responseStatus === 'ACCEPTED' || m.responseStatus === 'ATTENDING' || m.responseStatus === 'JOINED' || m.joinedAt;
            if (didAttend) {
                totalAttendedMeetings++;
                totalMeetingMinutes += m.meetingId?.durationMinutes || 30;
            }
        });

        const meetingAttendanceRate = meetings.length > 0
            ? Math.round((totalAttendedMeetings / meetings.length) * 100)
            : 100;

        const actualHoursTracked = Number((totalTrackedSeconds / 3600).toFixed(1));

        return {
            employeeId,
            dateRange: {
                preset,
                startDate: startStr,
                endDate: endStr,
            },
            taskMetrics: {
                assigned,
                completed,
                inProgress,
                overdue,
                blocked,
                awaitingReview,
                completionRate,
                onTimeCompletionRate,
            },
            dailyTrends,
            projectWorkload,
            durationComparison: {
                estimatedHoursTotal: Number(totalEstimatedHours.toFixed(1)),
                actualHoursTrackedTotal: actualHoursTracked,
                varianceHours: Number((actualHoursTracked - totalEstimatedHours).toFixed(1)),
            },
            attendanceMetrics: {
                totalDays: attendances.length,
                presentDays,
                absentDays,
                lateDays,
                halfDays,
                leaveDays,
                averageWorkHoursPerDay,
                totalOvertimeHours: Number(totalOvertimeHours.toFixed(1)),
            },
            meetingMetrics: {
                totalScheduled: meetings.length,
                totalAttended: totalAttendedMeetings,
                totalDurationMinutes: totalMeetingMinutes,
                attendanceRate: meetingAttendanceRate,
            },
        };
    }

    /**
     * ─── 10. Employee-Specific Alerts ───────────────────────────────────────────
     */
    public static async getEmployeeAlerts(
        companyId: string,
        employeeId: string,
        params: {
            status?: string;
            severity?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ alerts: IMonitoringAlertDto[]; total: number; page: number; limit: number }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);

        const filter: any = {
            companyId: companyObjId,
            $or: [{ resourceId: employeeObjId }, { 'metadata.employeeId': employeeId }],
        };

        if (params.status && params.status !== 'ALL') {
            filter.status = params.status;
        }
        if (params.severity) {
            filter.severity = params.severity;
        }

        const total = await MonitoringAlert.countDocuments(filter);
        const page = Math.max(1, params.page || 1);
        const limit = Math.min(100, Math.max(1, params.limit || 20));
        const skip = (page - 1) * limit;

        const alerts = await MonitoringAlert.find(filter)
            .populate<{ acknowledgedById: { _id: Types.ObjectId; name: string } }>('acknowledgedById', 'name')
            .populate<{ resolvedById: { _id: Types.ObjectId; name: string } }>('resolvedById', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        return {
            alerts: alerts.map((alt) => ({
                id: (alt as any)._id.toString(),
                companyId: alt.companyId.toString(),
                alertType: alt.alertType,
                severity: alt.severity,
                title: alt.title,
                summary: alt.summary,
                resourceType: alt.resourceType,
                resourceId: alt.resourceId ? alt.resourceId.toString() : undefined,
                status: alt.status,
                acknowledgedBy: alt.acknowledgedById
                    ? { id: (alt.acknowledgedById as any)._id.toString(), name: (alt.acknowledgedById as any).name }
                    : null,
                acknowledgedAt: alt.acknowledgedAt || null,
                resolvedBy: alt.resolvedById
                    ? { id: (alt.resolvedById as any)._id.toString(), name: (alt.resolvedById as any).name }
                    : null,
                resolvedAt: alt.resolvedAt || null,
                createdAt: alt.createdAt,
                metadata: alt.metadata,
            })),
            total,
            page,
            limit,
        };
    }

    /**
     * ─── 11. Historical Reports and Export (CSV Generator) ──────────────────────
     */
    public static async exportEmployeeReport(
        companyId: string,
        employeeId: string,
        params: {
            type: DetailedReportType;
            format?: 'csv' | 'json';
            startDate?: string;
            endDate?: string;
        }
    ): Promise<{ content: string; filename: string; contentType: string }> {
        const profile = await this.getEmployeeProfile(companyId, employeeId);
        const safeName = profile.name.replace(/[^a-zA-Z0-9]/g, '_');
        const nowStr = new Date().toISOString().split('T')[0];

        switch (params.type) {
            case 'ATTENDANCE': {
                const attData = await this.getEmployeeAttendanceHistory(companyId, employeeId, {
                    startDate: params.startDate,
                    endDate: params.endDate,
                    limit: 100,
                });

                const headers = ['Date', 'Status', 'Punch Status', 'Check In', 'Check Out', 'Scheduled (Mins)', 'Worked (Mins)', 'Break (Mins)', 'Late (Mins)', 'Early Leave (Mins)', 'Overtime (Mins)'];
                const rows = attData.records.map((r) => [
                    r.date,
                    r.status,
                    r.punchStatus,
                    r.checkInTime || 'N/A',
                    r.checkOutTime || 'N/A',
                    r.scheduled.workingMinutes,
                    r.actual.workedMinutes,
                    r.breakDurationMinutes,
                    r.metrics.lateMinutes,
                    r.metrics.earlyLeaveMinutes,
                    r.metrics.overtimeMinutes,
                ]);

                const csv = this.formatCsv(headers, rows);
                return {
                    content: csv,
                    filename: `${safeName}_Attendance_Report_${nowStr}.csv`,
                    contentType: 'text/csv; charset=utf-8',
                };
            }

            case 'TASKS': {
                const taskData = await this.getEmployeeTasks(companyId, employeeId, {
                    startDate: params.startDate,
                    endDate: params.endDate,
                    limit: 100,
                });

                const headers = ['Task Number', 'Title', 'Project', 'Priority', 'Status', 'Progress (%)', 'Estimated Hours', 'Actual Hours', 'Due Date', 'Overdue'];
                const rows = taskData.tasks.map((t) => [
                    t.taskNumber || 'N/A',
                    `"${t.title.replace(/"/g, '""')}"`,
                    `"${t.project.name.replace(/"/g, '""')}"`,
                    t.priority,
                    t.status,
                    t.progress,
                    t.estimatedTime?.hours || 0,
                    t.actualHours,
                    t.deliveryDate ? new Date(t.deliveryDate).toISOString().split('T')[0] : 'N/A',
                    t.isOverdue ? 'YES' : 'NO',
                ]);

                const csv = this.formatCsv(headers, rows);
                return {
                    content: csv,
                    filename: `${safeName}_Tasks_Report_${nowStr}.csv`,
                    contentType: 'text/csv; charset=utf-8',
                };
            }

            case 'PROJECTS': {
                const projData = await this.getEmployeeProjects(companyId, employeeId, { limit: 100 });
                const headers = ['Project Name', 'Role', 'Status', 'Priority', 'Total Tasks', 'Completed Tasks', 'In Progress Tasks', 'Overdue Tasks', 'Tracked Hours'];
                const rows = projData.projects.map((p) => [
                    `"${p.name.replace(/"/g, '""')}"`,
                    p.employeeRole,
                    p.status,
                    p.priority,
                    p.totalTasks,
                    p.completedTasks,
                    p.inProgressTasks,
                    p.overdueTasks,
                    (p.trackedTimeSeconds / 3600).toFixed(1),
                ]);

                const csv = this.formatCsv(headers, rows);
                return {
                    content: csv,
                    filename: `${safeName}_Projects_Report_${nowStr}.csv`,
                    contentType: 'text/csv; charset=utf-8',
                };
            }

            case 'MEETINGS': {
                const meetData = await this.getEmployeeMeetings(companyId, employeeId, {
                    from: params.startDate,
                    to: params.endDate,
                    limit: 100,
                });
                const headers = ['Title', 'Scheduled Start', 'Scheduled End', 'Organizer', 'Project', 'RSVP Status', 'Did Attend', 'Duration (Mins)'];
                const rows = meetData.meetings.map((m) => [
                    `"${m.title.replace(/"/g, '""')}"`,
                    new Date(m.scheduledStartAt).toISOString(),
                    new Date(m.scheduledEndAt).toISOString(),
                    `"${m.organizer.name.replace(/"/g, '""')}"`,
                    m.project ? `"${m.project.name.replace(/"/g, '""')}"` : 'N/A',
                    m.invitationStatus,
                    m.participation.didAttend ? 'YES' : 'NO',
                    m.participation.durationMinutes,
                ]);

                const csv = this.formatCsv(headers, rows);
                return {
                    content: csv,
                    filename: `${safeName}_Meetings_Report_${nowStr}.csv`,
                    contentType: 'text/csv; charset=utf-8',
                };
            }

            case 'WORKLOAD_SUMMARY':
            default: {
                const analytics = await this.getEmployeeAnalytics(companyId, employeeId, {
                    startDate: params.startDate,
                    endDate: params.endDate,
                });

                const headers = ['Metric', 'Value'];
                const rows = [
                    ['Employee Name', profile.name],
                    ['Employee Email', profile.email],
                    ['Designation', profile.designation?.name || 'N/A'],
                    ['Department', profile.department || 'N/A'],
                    ['Report Period', `${analytics.dateRange.startDate} to ${analytics.dateRange.endDate}`],
                    ['Total Tasks Assigned', analytics.taskMetrics.assigned],
                    ['Completed Tasks', analytics.taskMetrics.completed],
                    ['Tasks In Progress', analytics.taskMetrics.inProgress],
                    ['Overdue Tasks', analytics.taskMetrics.overdue],
                    ['Blocked Tasks', analytics.taskMetrics.blocked],
                    ['Task Completion Rate (%)', analytics.taskMetrics.completionRate],
                    ['On-Time Completion Rate (%)', analytics.taskMetrics.onTimeCompletionRate],
                    ['Total Estimated Hours', analytics.durationComparison.estimatedHoursTotal],
                    ['Total Tracked Work Hours', analytics.durationComparison.actualHoursTrackedTotal],
                    ['Work Hours Variance', analytics.durationComparison.varianceHours],
                    ['Present Days', analytics.attendanceMetrics.presentDays],
                    ['Absent Days', analytics.attendanceMetrics.absentDays],
                    ['Late Days', analytics.attendanceMetrics.lateDays],
                    ['Half Days', analytics.attendanceMetrics.halfDays],
                    ['Leave Days', analytics.attendanceMetrics.leaveDays],
                    ['Average Work Hours / Day', analytics.attendanceMetrics.averageWorkHoursPerDay],
                    ['Total Overtime Hours', analytics.attendanceMetrics.totalOvertimeHours],
                    ['Total Meetings Attended', analytics.meetingMetrics.totalAttended],
                    ['Total Meeting Duration (Mins)', analytics.meetingMetrics.totalDurationMinutes],
                ];

                const csv = this.formatCsv(headers, rows);
                return {
                    content: csv,
                    filename: `${safeName}_Workload_Summary_${nowStr}.csv`,
                    contentType: 'text/csv; charset=utf-8',
                };
            }
        }
    }

    private static formatCsv(headers: string[], rows: (string | number | Date | null | undefined)[][]): string {
        const headerLine = headers.join(',');
        const rowLines = rows.map((r) =>
            r
                .map((cell) => {
                    if (cell === null || cell === undefined) return '';
                    if (cell instanceof Date) return cell.toISOString();
                    return String(cell);
                })
                .join(',')
        );
        return [headerLine, ...rowLines].join('\r\n');
    }
}
export default DetailedMonitoringService;
