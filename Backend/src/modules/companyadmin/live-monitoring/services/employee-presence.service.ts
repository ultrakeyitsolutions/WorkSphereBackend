import { Types } from 'mongoose';
import { PresenceService as GlobalPresenceService } from '../../../../sockets/presence.service';
import {
    EmployeeWorkStatus,
    IEmployeePresenceRecord,
} from '../live-monitoring.types';
import CompanyMember from '../../invitations/company-member.model';
import { Attendance, AttendanceStatus } from '../../../attendance/attendance.model';
import AttendanceEvent from '../../../attendance/attendance-event.model';
import { AttendanceEventType, LeaveStatus } from '../../../attendance/attendance.types';
import LeaveRequest from '../../../attendance/leave.model';
import { Task } from '../../../tasks/task.model';
import { Meeting } from '../../../meetings/models/meeting.model';
import { MeetingStatus } from '../../../meetings/meeting.types';
import { MeetingParticipant } from '../../../meetings/models/meeting-participant.model';
import { TimeTracking, TrackingState } from '../../../task-tracking/time-tracking.model';

interface PresenceMetadata {

    lastSeenAt: Date;
    lastHeartbeatAt: Date;
}

export class EmployeePresenceService {
    // In-memory heartbeat and lastSeen cache to avoid constant MongoDB writes on every socket ping
    private static presenceCache = new Map<string, PresenceMetadata>();
    private static presenceSnapshotCache = new Map<string, { data: IEmployeePresenceRecord[]; cachedAt: number }>();
    private static inFlightPresence = new Map<string, Promise<IEmployeePresenceRecord[]>>();
    private static readonly PRESENCE_CACHE_TTL_MS = 3000;

    /**
     * Record a heartbeat from an authenticated socket connection
     */
    public static recordHeartbeat(userId: string): void {
        const now = new Date();
        const existing = this.presenceCache.get(userId);
        if (existing) {
            existing.lastHeartbeatAt = now;
            existing.lastSeenAt = now;
        } else {
            this.presenceCache.set(userId, {
                lastSeenAt: now,
                lastHeartbeatAt: now,
            });
        }
    }

    /**
     * Record disconnect timestamp
     */
    public static recordDisconnect(userId: string): void {
        const existing = this.presenceCache.get(userId);
        const now = new Date();
        if (existing) {
            existing.lastSeenAt = now;
        } else {
            this.presenceCache.set(userId, {
                lastSeenAt: now,
                lastHeartbeatAt: now,
            });
        }
    }

    /**
     * Determine if a user is currently online via active socket connections
     */
    public static isUserOnline(userId: string): boolean {
        return GlobalPresenceService.isUserOnline(userId);
    }

    /**
     * Get presence metadata for a user
     */
    public static getPresence(userId: string): { isOnline: boolean; lastSeenAt: Date | null } {
        const isOnline = this.isUserOnline(userId);
        const cached = this.presenceCache.get(userId);
        return {
            isOnline,
            lastSeenAt: cached?.lastSeenAt || (isOnline ? new Date() : null),
        };
    }

    /**
     * Resolves the real-time presence, work state, attendance, and active tasks
     * for all employees in a company.
     */
    public static async resolveCompanyEmployeesPresence(
        companyId: string,
        todayStr: string = new Date().toISOString().split('T')[0]
    ): Promise<IEmployeePresenceRecord[]> {
        const cacheKey = `${companyId}:${todayStr}`;
        const now = Date.now();
        const cached = this.presenceSnapshotCache.get(cacheKey);
        if (cached && now - cached.cachedAt < this.PRESENCE_CACHE_TTL_MS) {
            return cached.data;
        }

        const existingPromise = this.inFlightPresence.get(cacheKey);
        if (existingPromise) {
            return existingPromise;
        }

        const fetchPromise = (async () => {
            try {
                const result = await this.resolveCompanyEmployeesPresenceInternal(companyId, todayStr);
                this.presenceSnapshotCache.set(cacheKey, { data: result, cachedAt: Date.now() });
                return result;
            } finally {
                this.inFlightPresence.delete(cacheKey);
            }
        })();

        this.inFlightPresence.set(cacheKey, fetchPromise);
        return await fetchPromise;
    }

    private static async resolveCompanyEmployeesPresenceInternal(
        companyId: string,
        todayStr: string
    ): Promise<IEmployeePresenceRecord[]> {
        const companyObjId = new Types.ObjectId(companyId);

        // 1. Fetch all active members/employees of the company
        const members = await CompanyMember.find({
            companyId: companyObjId,
            status: 'ACTIVE',
        })
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string } }>('userId', 'name email avatar')
            .populate<{ designationId: { _id: Types.ObjectId; name: string; department?: string } }>('designationId', 'name department')
            .lean();

        if (!members.length) return [];

        const userIds = members
            .filter((m: any) => m.userId && m.userId._id)
            .map((m: any) => m.userId._id);

        // Run independent queries in parallel
        const [attendances, approvedLeaves, activeMeetings, activeTrackings, activeTasks] = await Promise.all([
            // Attendance
            Attendance.find({
                companyId: companyObjId,
                employeeId: { $in: userIds },
                date: todayStr,
            }).lean(),

            // Approved leaves
            LeaveRequest.find({
                companyId: companyObjId as any,
                employeeId: { $in: userIds },
                status: LeaveStatus.APPROVED,
                startDate: { $lte: todayStr },
                endDate: { $gte: todayStr },
            }).lean(),

            // In-progress meetings
            Meeting.find({
                companyId: companyObjId,
                status: MeetingStatus.IN_PROGRESS,
            }).lean(),

            // Active live time-tracking sessions
            TimeTracking.find({
                companyId: companyObjId,
                userId: { $in: userIds },
                state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED] },
            })
                .populate<{ taskId: { _id: Types.ObjectId; title: string; taskNumber?: string; status?: string; progress?: number; priority?: string } }>('taskId', 'title taskNumber status progress priority')
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            // In-progress / recently active tasks
            Task.find({
                companyId: companyObjId,
                assignedToId: { $in: userIds },
                isArchived: false,
                isActive: true,
            })
                .sort({ updatedAt: -1 })
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),
        ]);

        const attendanceMap = new Map<string, any>();
        attendances.forEach((a: any) => attendanceMap.set(a.employeeId.toString(), a));

        // Sub-queries dependent on above queries (break events & meeting participants)
        const attendanceIds = attendances.map((a: any) => a._id);
        const activeMeetingIds = activeMeetings.map((m: any) => m._id);

        const [breakEvents, activeParticipants] = await Promise.all([
            attendanceIds.length
                ? AttendanceEvent.find({
                      attendanceId: { $in: attendanceIds },
                      type: { $in: [AttendanceEventType.BREAK_START, AttendanceEventType.BREAK_END] },
                  })
                      .sort({ timestamp: -1 })
                      .lean()
                : Promise.resolve([]),

            activeMeetingIds.length
                ? MeetingParticipant.find({
                      meetingId: { $in: activeMeetingIds },
                      userId: { $in: userIds },
                      status: { $in: ['ACCEPTED', 'ATTENDING', 'JOINED'] },
                  }).lean()
                : Promise.resolve([]),
        ]);

        const latestBreakEventMap = new Map<string, any>();
        breakEvents.forEach((ev: any) => {
            const key = ev.employeeId.toString();
            if (!latestBreakEventMap.has(key)) {
                latestBreakEventMap.set(key, ev);
            }
        });

        const leaveSet = new Set(approvedLeaves.map((l: any) => l.employeeId.toString()));
        const inMeetingSet = new Set(activeParticipants.map((p: any) => p.userId.toString()));

        const liveTrackingMap = new Map<string, any>();
        activeTrackings.forEach((trk: any) => {
            const uid = trk.userId?.toString();
            if (uid) liveTrackingMap.set(uid, trk);
        });

        const userTaskMap = new Map<string, any>();
        activeTasks.forEach((t: any) => {
            const uid = t.assignedToId?.toString();
            if (uid && !userTaskMap.has(uid)) {
                userTaskMap.set(uid, t);
            }
        });

        // 7. Compose final presence records
        const records: IEmployeePresenceRecord[] = [];

        for (const member of members) {
            const user = (member as any).userId;
            if (!user || !user._id) continue;

            const userIdStr = user._id.toString();
            const isOnline = this.isUserOnline(userIdStr);
            const presenceMeta = this.presenceCache.get(userIdStr);

            const attendance = attendanceMap.get(userIdStr);
            const latestBreak = latestBreakEventMap.get(userIdStr);
            const isOnLeave = leaveSet.has(userIdStr);
            const isInMeeting = inMeetingSet.has(userIdStr);
            const liveTracking = liveTrackingMap.get(userIdStr);
            const currentTaskDoc = liveTracking?.taskId || userTaskMap.get(userIdStr);

            // Compute work status accurately
            let workStatus: EmployeeWorkStatus = 'OFFLINE';
            let attendanceStatus: string = 'ABSENT';

            if (isOnLeave) {
                workStatus = 'ON_LEAVE';
                attendanceStatus = 'ON_LEAVE';
            } else if (isInMeeting) {
                workStatus = 'IN_MEETING';
                attendanceStatus = attendance?.status || (isOnline ? 'PRESENT' : 'ABSENT');
            } else if (latestBreak && latestBreak.type === AttendanceEventType.BREAK_START) {
                workStatus = 'ON_BREAK';
                attendanceStatus = attendance?.status || 'PRESENT';
            } else if (liveTracking && liveTracking.state === TrackingState.TRACKING) {
                workStatus = 'WORKING';
                attendanceStatus = attendance?.status || 'PRESENT';
            } else if (liveTracking && liveTracking.state === TrackingState.PAUSED) {
                workStatus = 'ON_BREAK';
                attendanceStatus = attendance?.status || 'PRESENT';
            } else if (attendance && (attendance.status === AttendanceStatus.PRESENT || attendance.status === AttendanceStatus.HALF_DAY)) {
                workStatus = isOnline ? 'WORKING' : 'IDLE';
                attendanceStatus = attendance.status;
            } else if (isOnline) {
                workStatus = 'IDLE';
                attendanceStatus = 'ABSENT';
            }

            // Current task context
            let currentTask = undefined;
            if (currentTaskDoc) {
                const proj = liveTracking?.projectId || currentTaskDoc.projectId;
                currentTask = {
                    taskId: currentTaskDoc._id.toString(),
                    id: currentTaskDoc._id.toString(),
                    taskTitle: currentTaskDoc.title,
                    title: currentTaskDoc.title,
                    taskNumber: currentTaskDoc.taskNumber,
                    taskStatus: currentTaskDoc.status || 'IN_PROGRESS',
                    status: currentTaskDoc.status || 'IN_PROGRESS',
                    projectId: proj?._id?.toString() || proj?.toString() || '',
                    projectName: proj?.name || 'General',
                    progress: typeof currentTaskDoc.progress === 'number' ? currentTaskDoc.progress : null,
                    priority: currentTaskDoc.priority || 'MEDIUM',
                };
            }


            records.push({
                employeeId: userIdStr,
                name: user.name || 'Unknown',
                email: user.email,
                avatar: user.avatar || null,
                department: (member as any).designationId?.department || null,
                designation: (member as any).designationId?.name || null,
                presenceStatus: isOnline ? 'ONLINE' : 'OFFLINE',
                workStatus,
                attendanceStatus,
                checkInTime: attendance?.checkInTime ? attendance.checkInTime.toISOString() : null,
                checkOutTime: attendance?.checkOutTime ? attendance.checkOutTime.toISOString() : null,
                workDurationMinutes: attendance?.totalWorkMinutes || 0,
                lastSeenAt: presenceMeta?.lastSeenAt ? presenceMeta.lastSeenAt.toISOString() : isOnline ? new Date().toISOString() : null,
                lastHeartbeatAt: presenceMeta?.lastHeartbeatAt ? presenceMeta.lastHeartbeatAt.toISOString() : null,
                connectionCount: isOnline ? 1 : 0,
                currentTask,
            });
        }

        return records;
    }

    /**
     * Resolve individual employee work status
     */
    public static async resolveWorkStatus(companyId: string, userId: string, isOnline: boolean): Promise<EmployeeWorkStatus> {
        const todayStr = new Date().toISOString().split('T')[0];
        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = new Types.ObjectId(userId);

        const leave = await LeaveRequest.findOne({
            companyId: companyObjId as any,
            employeeId: userObjId,
            status: LeaveStatus.APPROVED,
            startDate: { $lte: todayStr },
            endDate: { $gte: todayStr },
        }).lean();
        if (leave) return 'ON_LEAVE';

        const activeMeeting = await Meeting.findOne({
            companyId: companyObjId,
            status: MeetingStatus.IN_PROGRESS,
        }).lean();
        if (activeMeeting) {
            const isParticipant = await MeetingParticipant.exists({
                meetingId: activeMeeting._id,
                userId: userObjId,
                status: { $in: ['ACCEPTED', 'ATTENDING', 'JOINED'] },
            });
            if (isParticipant) return 'IN_MEETING';
        }

        const attendance = await Attendance.findOne({
            companyId: companyObjId,
            employeeId: userObjId,
            date: todayStr,
        }).lean();

        if (attendance) {
            const latestBreak = await AttendanceEvent.findOne({
                attendanceId: attendance._id,
                type: { $in: [AttendanceEventType.BREAK_START, AttendanceEventType.BREAK_END] },
            })
                .sort({ timestamp: -1 })
                .lean();

            if (latestBreak && latestBreak.type === AttendanceEventType.BREAK_START) {
                return 'ON_BREAK';
            }

            return isOnline ? 'WORKING' : 'IDLE';
        }

        return isOnline ? 'IDLE' : 'OFFLINE';
    }
}
export default EmployeePresenceService;
