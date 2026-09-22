import { Types } from 'mongoose';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { TimeTracking, TrackingState } from '../../task-tracking/time-tracking.model';
import { CalendarEvent } from '../../calendar/calendar-event.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { DashboardScopeContext, LiveMonitoringResponse, LiveMonitoringUser, LiveUserStatus } from '../dashboard.types';

export class MonitoringAnalytics {
    public static async getLiveSnapshot(
        context: DashboardScopeContext,
        now = new Date()
    ): Promise<LiveMonitoringResponse> {
        const { companyId, userId, isCompanyWide, hasLiveMonitoring } = context;

        // 1. Employee / Member: Never receive other employees' monitoring
        if (!isCompanyWide) {
            const startOfDay = new Date(now);
            startOfDay.setHours(0, 0, 0, 0);

            const [activeAttendance, activeTracking, ongoingMeeting, recentActivity] = await Promise.all([
                Attendance.findOne({ companyId, userId, status: AttendanceStatus.CHECKED_IN }).lean(),
                TimeTracking.findOne({
                    companyId,
                    userId,
                    state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] },
                }).lean(),
                CalendarEvent.findOne({
                    companyId,
                    startTime: { $lte: now },
                    endTime: { $gte: now },
                    $or: [{ 'organizer.userId': userId }, { 'participants.userId': userId }],
                }).lean(),
                TaskActivity.findOne({ companyId, userId }).sort({ createdAt: -1 }).lean(),
            ]);

            let status: LiveUserStatus = 'offline';
            let durationMinutes = 0;

            if (!activeAttendance) {
                status = 'offline';
            } else if (ongoingMeeting) {
                status = 'meeting';
                durationMinutes = Math.max(0, Math.round((now.getTime() - startOfDay.getTime()) / 60000));
            } else if (activeTracking) {
                status = activeTracking.state === TrackingState.TRACKING ? 'working' : 'break';
                const sessionStart = activeTracking.startedAt ? new Date(activeTracking.startedAt).getTime() : now.getTime();
                durationMinutes = Math.max(0, Math.round((now.getTime() - sessionStart) / 60000));
            } else {
                status = 'idle';
                const checkInMs = new Date(activeAttendance.checkInTime).getTime();
                durationMinutes = Math.max(0, Math.round((now.getTime() - checkInMs) / 60000));
            }

            const lastActivityAt = recentActivity ? new Date(recentActivity.createdAt).toISOString() : null;

            return {
                enabled: false, // Company monitoring disabled for employees
                self: {
                    userId: String(userId),
                    status,
                    durationMinutes,
                    lastActivityAt,
                },
            };
        }

        // 2. Company Admin without LIVE_MONITORING_READ permission
        if (!hasLiveMonitoring) {
            return { enabled: false };
        }

        // 3. Company Admin with permission -> Full Company Monitoring
        const companyMembers = await CompanyMember.find({
            companyId,
            memberType: { $in: ['EMPLOYEE', 'MANAGER'] },
            status: 'ACTIVE',
        })
            .populate<{ userId: { _id: Types.ObjectId; name: string; email: string; avatar?: string; isActive: boolean; status: string } }>(
                'userId',
                'name email avatar isActive status'
            )
            .lean();

        const activeUsers = companyMembers
            .map((m) => m.userId)
            .filter((u) => u && u.isActive && u.status !== 'DEACTIVATED');

        if (activeUsers.length === 0) {
            return {
                enabled: true,
                summary: { working: 0, idle: 0, break: 0, meeting: 0, offline: 0 },
                users: [],
            };
        }

        const userIds = activeUsers.map((u) => u._id);
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const [activeAttendances, activeTrackings, ongoingMeetings, recentActivities] = await Promise.all([
            Attendance.find({
                companyId,
                userId: { $in: userIds },
                status: AttendanceStatus.CHECKED_IN,
            }).lean(),
            TimeTracking.find({
                companyId,
                userId: { $in: userIds },
                state: { $in: [TrackingState.TRACKING, TrackingState.PAUSED, TrackingState.ON_HOLD] },
            })
                .populate('projectId', 'name')
                .populate('taskId', 'title taskNumber')
                .lean(),
            CalendarEvent.find({
                companyId,
                startTime: { $lte: now },
                endTime: { $gte: now },
            }).lean(),
            TaskActivity.aggregate([
                { $match: { companyId, userId: { $in: userIds } } },
                { $sort: { createdAt: -1 } },
                { $group: { _id: '$userId', lastActivityAt: { $first: '$createdAt' } } },
            ]),
        ]);

        const attendanceMap = new Map<string, any>();
        activeAttendances.forEach((a) => attendanceMap.set(String(a.userId), a));

        const trackingMap = new Map<string, any>();
        activeTrackings.forEach((t) => trackingMap.set(String(t.userId), t));

        const meetingUserSet = new Set<string>();
        ongoingMeetings.forEach((m) => {
            if (m.organizer?.userId) meetingUserSet.add(String(m.organizer.userId));
            if (Array.isArray(m.participants)) {
                m.participants.forEach((p: any) => {
                    if (p.userId && p.status !== 'declined') meetingUserSet.add(String(p.userId));
                });
            }
        });

        const activityMap = new Map<string, Date>();
        recentActivities.forEach((act: any) => activityMap.set(String(act._id), new Date(act.lastActivityAt)));

        const monitoringUsers: LiveMonitoringUser[] = [];
        const summary = { working: 0, idle: 0, break: 0, meeting: 0, offline: 0 };

        for (const user of activeUsers) {
            const uidStr = String(user._id);
            const attendance = attendanceMap.get(uidStr);
            const tracking = trackingMap.get(uidStr);
            const isMeeting = meetingUserSet.has(uidStr);
            const lastActivity = activityMap.get(uidStr) || (attendance ? new Date(attendance.checkInTime) : null);

            let status: LiveUserStatus = 'offline';
            let projectName: string | null = null;
            let taskName: string | null = null;
            let durationMinutes = 0;

            if (!attendance) {
                status = 'offline';
                summary.offline++;
            } else if (isMeeting) {
                status = 'meeting';
                summary.meeting++;
                durationMinutes = Math.max(0, Math.round((now.getTime() - startOfDay.getTime()) / 60000));
            } else if (tracking) {
                if (tracking.state === TrackingState.TRACKING) {
                    status = 'working';
                    summary.working++;
                } else {
                    status = 'break';
                    summary.break++;
                }
                projectName = (tracking.projectId as any)?.name || null;
                taskName = (tracking.taskId as any)?.title || (tracking.taskId as any)?.taskNumber || null;

                const sessionStart = tracking.startedAt ? new Date(tracking.startedAt).getTime() : now.getTime();
                durationMinutes = Math.max(0, Math.round((now.getTime() - sessionStart) / 60000));
            } else {
                status = 'idle';
                summary.idle++;
                const checkInMs = new Date(attendance.checkInTime).getTime();
                durationMinutes = Math.max(0, Math.round((now.getTime() - checkInMs) / 60000));
            }

            monitoringUsers.push({
                userId: uidStr,
                name: user.name,
                avatar: (user as any).avatar || null,
                status,
                project: projectName,
                task: taskName,
                durationMinutes,
                lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
            });
        }

        return {
            enabled: true,
            summary,
            users: monitoringUsers,
        };
    }
}
