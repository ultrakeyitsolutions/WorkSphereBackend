import { TimelineEventDto } from '../performance.types';

export class TimelineService {
    /**
     * Merges multi-source logs (attendance, tracking sessions, activities, meetings)
     * into a single unified chronological timeline list.
     */
    public static buildTimeline(
        attendanceLogs: any[],
        trackingLogs: any[],
        taskActivities: any[],
        meetingLogs: any[]
    ): TimelineEventDto[] {
        const events: TimelineEventDto[] = [];

        // 1. Attendance Events
        for (const a of attendanceLogs) {
            if (a.checkInTime) {
                events.push({
                    timestamp: new Date(a.checkInTime),
                    type: 'ATTENDANCE',
                    title: 'Work Check-In',
                    description: `Checked in for work`,
                    category: 'ATTENDANCE',
                    metadata: { attendanceId: a._id, status: 'CHECKED_IN' },
                });
            }
            if (a.checkOutTime) {
                events.push({
                    timestamp: new Date(a.checkOutTime),
                    type: 'ATTENDANCE',
                    title: 'Work Check-Out',
                    description: `Checked out from work`,
                    category: 'ATTENDANCE',
                    metadata: { attendanceId: a._id, status: 'CHECKED_OUT' },
                });
            }
        }

        // 2. Time Tracking Session Events
        for (const t of trackingLogs) {
            if (t.startedAt) {
                const taskTitle = t.taskId?.title || t.taskTitle || 'Task';
                events.push({
                    timestamp: new Date(t.startedAt),
                    type: 'TRACKING',
                    title: `Started Tracking: ${taskTitle}`,
                    description: `Started work on task ${taskTitle}`,
                    category: 'TRACKING',
                    metadata: { trackingId: t._id, taskId: t.taskId?._id || t.taskId, state: t.state },
                });
            }
            if (t.endedAt) {
                const taskTitle = t.taskId?.title || t.taskTitle || 'Task';
                const mins = Math.round((t.workedSeconds || 0) / 60);
                events.push({
                    timestamp: new Date(t.endedAt),
                    type: 'TRACKING',
                    title: `Stopped Tracking: ${taskTitle}`,
                    description: `Logged ${mins} minutes on task ${taskTitle}`,
                    category: 'TRACKING',
                    metadata: { trackingId: t._id, taskId: t.taskId?._id || t.taskId, workedSeconds: t.workedSeconds },
                });
            }
        }

        // 3. Task Activities / Comments / Status Events
        for (const act of taskActivities) {
            const taskTitle = act.taskId?.title || 'Task';
            events.push({
                timestamp: new Date(act.createdAt),
                type: 'TASK_ACTIVITY',
                title: `${act.type.replace('_', ' ')} on ${taskTitle}`,
                description: act.content || `Activity performed on task ${taskTitle}`,
                category: 'TASK',
                metadata: { activityId: act._id, taskId: act.taskId?._id || act.taskId, activityType: act.type },
            });
        }

        // 4. Meeting Events
        for (const m of meetingLogs) {
            if (m.startTime) {
                events.push({
                    timestamp: new Date(m.startTime),
                    type: 'MEETING',
                    title: `Meeting: ${m.title}`,
                    description: `Attended meeting ${m.title}`,
                    category: 'MEETING',
                    metadata: { meetingId: m._id, meetingUrl: m.meetingUrl, provider: m.provider },
                });
            }
        }

        // Single O(n log n) Chronological Sort (descending: newest first)
        events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return events;
    }
}
