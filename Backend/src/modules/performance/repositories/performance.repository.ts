import { Types } from 'mongoose';
import { Attendance } from '../../attendance/attendance.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Task } from '../../tasks/task.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { CalendarEvent } from '../../calendar/calendar-event.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { AttendanceMetricsDto, MeetingMetricsDto, ProjectMetricsDto, TaskMetricsDto, TimeTrackingMetricsDto } from '../performance.types';
import { IntervalUtil } from '../utils/interval.util';

export class PerformanceRepository {
    /**
     * Aggregates attendance metrics for a user over a date range.
     */
    public static async getAttendanceMetrics(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date
    ): Promise<{ metrics: AttendanceMetricsDto; rawLogs: any[] }> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const logs = await Attendance.find({
            companyId: cId,
            userId: uId,
            checkInTime: { $gte: from, $lte: to },
        })
            .sort({ checkInTime: -1 })
            .lean();

        // Calculate total days in range
        const totalDaysInRange = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
        const checkedInDaysSet = new Set<string>();

        let totalCheckedInMs = 0;

        for (const log of logs) {
            const dateStr = log.checkInTime.toISOString().split('T')[0];
            checkedInDaysSet.add(dateStr);

            const checkOutTime = log.checkOutTime || (log.checkInTime.getTime() > Date.now() - 86400000 ? new Date() : log.checkInTime);
            totalCheckedInMs += checkOutTime.getTime() - log.checkInTime.getTime();
        }

        const checkedInDays = checkedInDaysSet.size;
        const totalCheckedInMinutes = Math.round(totalCheckedInMs / (1000 * 60));
        const averageCheckedInMinutesPerDay = checkedInDays > 0 ? Math.round(totalCheckedInMinutes / checkedInDays) : 0;

        return {
            metrics: {
                totalDaysInRange,
                checkedInDays,
                totalCheckedInMinutes,
                averageCheckedInMinutesPerDay,
            },
            rawLogs: logs,
        };
    }

    /**
     * Aggregates time tracking sessions and intervals for work, break, and hold durations.
     */
    public static async getTimeTrackingMetrics(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date
    ): Promise<{ metrics: TimeTrackingMetricsDto; rawLogs: any[] }> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const sessions = await TimeTracking.find({
            companyId: cId,
            userId: uId,
            startedAt: { $gte: from, $lte: to },
        })
            .populate('taskId', 'title taskNumber')
            .sort({ startedAt: -1 })
            .lean();

        let workMs = 0;
        let breakMs = 0;
        let holdMs = 0;

        const rawWorkIntervals: Array<{ start: Date; end: Date }> = [];

        for (const session of sessions) {
            workMs += (session.workedSeconds || 0) * 1000;

            if (session.startedAt && (session.endedAt || session.workedSeconds)) {
                const end = session.endedAt || new Date(session.startedAt.getTime() + (session.workedSeconds || 0) * 1000);
                rawWorkIntervals.push({ start: session.startedAt, end });
            }

            if (session.intervals && Array.isArray(session.intervals)) {
                for (const interval of session.intervals) {
                    if (interval.startedAt && interval.endedAt) {
                        const duration = interval.endedAt.getTime() - interval.startedAt.getTime();
                        if (interval.type === 'BREAK') {
                            breakMs += duration;
                        } else if (interval.type === 'HOLD') {
                            holdMs += duration;
                        }
                    }
                }
            }
        }

        const workMinutes = Math.round(workMs / (1000 * 60));
        const breakMinutes = Math.round(breakMs / (1000 * 60));
        const holdMinutes = Math.round(holdMs / (1000 * 60));

        // Use interval merging utility for net productive minutes
        const netProductiveMinutes = IntervalUtil.calculateNetMinutes(rawWorkIntervals);
        const totalTrackedMinutes = workMinutes + breakMinutes + holdMinutes;

        const totalDaysInRange = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
        const avgDailyTrackedMinutes = Math.round(totalTrackedMinutes / totalDaysInRange);

        return {
            metrics: {
                totalTrackedMinutes,
                workMinutes,
                breakMinutes,
                holdMinutes,
                netProductiveMinutes,
                avgDailyTrackedMinutes,
            },
            rawLogs: sessions,
        };
    }

    /**
     * Aggregates task breakdown metrics (assigned, completed, in-progress, overdue).
     */
    public static async getTaskMetrics(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date
    ): Promise<TaskMetricsDto> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const tasks = await Task.find({
            companyId: cId,
            assignedToId: uId,
            isArchived: false,
            createdAt: { $lte: to },
        })
            .populate('statusId', 'name')
            .lean();

        let completed = 0;
        let inProgress = 0;
        let pending = 0;
        let overdue = 0;

        const now = new Date();

        for (const task of tasks) {
            const statusName = (task.statusId as any)?.name?.toUpperCase() || '';
            const isDone = statusName.includes('DONE') || statusName.includes('COMPLETE') || !!task.completedDate;

            if (isDone) {
                completed++;
            } else if (statusName.includes('IN_PROGRESS') || statusName.includes('PROGRESS') || statusName.includes('WORKING')) {
                inProgress++;
            } else {
                pending++;
            }

            if (!isDone && task.dueDate && new Date(task.dueDate).getTime() < now.getTime()) {
                overdue++;
            }
        }

        const totalAssigned = tasks.length;
        const completionRatePercentage = totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 0;

        return {
            totalAssigned,
            completed,
            inProgress,
            pending,
            overdue,
            completionRatePercentage,
        };
    }

    /**
     * Aggregates project membership and active vs completed project counts.
     */
    public static async getProjectMetrics(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<ProjectMetricsDto> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const [teamMemberProjects, inChargeProjects] = await Promise.all([
            ProjectTeamMember.find({ userId: uId }).select('projectId').lean(),
            ProjectInCharge.find({ userId: uId }).select('projectId').lean(),
        ]);

        const projectIds = new Set<string>();
        for (const tm of teamMemberProjects) projectIds.add(tm.projectId.toString());
        for (const ic of inChargeProjects) projectIds.add(ic.projectId.toString());

        if (projectIds.size === 0) {
            return { totalProjects: 0, activeProjects: 0, completedProjects: 0 };
        }

        const objectIds = Array.from(projectIds).map((id) => new Types.ObjectId(id));
        const projects = await Project.find({
            _id: { $in: objectIds },
            companyId: cId,
            deletedAt: null,
        }).lean();

        let activeProjects = 0;
        let completedProjects = 0;

        for (const p of projects) {
            if (p.status === ProjectStatus.COMPLETED || p.status === ProjectStatus.ARCHIVED) {
                completedProjects++;
            } else {
                activeProjects++;
            }
        }

        return {
            totalProjects: projects.length,
            activeProjects,
            completedProjects,
        };
    }

    /**
     * Aggregates meeting stats (total meetings, organized count, attended count, total meeting minutes).
     */
    public static async getMeetingMetrics(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date
    ): Promise<{ metrics: MeetingMetricsDto; rawLogs: any[] }> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        const meetings = await CalendarEvent.find({
            companyId: cId,
            $or: [
                { 'participants.userId': uId },
                { 'organizer.userId': uId },
            ],
            startTime: { $gte: from, $lte: to },
        })
            .sort({ startTime: -1 })
            .lean();

        let organizedCount = 0;
        let attendedCount = 0;
        let totalMeetingMs = 0;

        for (const m of meetings) {
            const isOrganizer = m.organizer?.userId?.toString() === userId.toString();
            if (isOrganizer) {
                organizedCount++;
            } else {
                attendedCount++;
            }

            if (m.startTime && m.endTime) {
                totalMeetingMs += new Date(m.endTime).getTime() - new Date(m.startTime).getTime();
            }
        }

        const totalMeetingMinutes = Math.round(totalMeetingMs / (1000 * 60));

        return {
            metrics: {
                totalMeetings: meetings.length,
                totalMeetingMinutes,
                organizedCount,
                attendedCount,
            },
            rawLogs: meetings,
        };
    }

    /**
     * Fetches task activities for timeline building.
     */
    public static async getTaskActivities(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date
    ): Promise<any[]> {
        return TaskActivity.find({
            companyId: new Types.ObjectId(companyId),
            userId: new Types.ObjectId(userId),
            createdAt: { $gte: from, $lte: to },
        })
            .populate('taskId', 'title taskNumber')
            .sort({ createdAt: -1 })
            .lean();
    }

    /**
     * Fetches detailed paginated task list.
     */
    public static async getDetailedTasks(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date,
        pageVal = 1,
        limitVal = 25
    ) {
        const page = Math.max(1, pageVal);
        const limit = Math.min(100, Math.max(1, limitVal));
        const skip = (page - 1) * limit;

        const query = {
            companyId: new Types.ObjectId(companyId),
            assignedToId: new Types.ObjectId(userId),
            isArchived: false,
            createdAt: { $lte: to },
        };

        const [tasks, total] = await Promise.all([
            Task.find(query)
                .populate('projectId', 'name')
                .populate('statusId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Task.countDocuments(query),
        ]);

        return {
            tasks,
            total,
            page,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Fetches detailed paginated meetings list.
     */
    public static async getDetailedMeetings(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        from: Date,
        to: Date,
        pageVal = 1,
        limitVal = 25
    ) {
        const page = Math.max(1, pageVal);
        const limit = Math.min(100, Math.max(1, limitVal));
        const skip = (page - 1) * limit;

        const query = {
            companyId: new Types.ObjectId(companyId),
            $or: [
                { 'participants.userId': new Types.ObjectId(userId) },
                { 'organizer.userId': new Types.ObjectId(userId) },
            ],
            startTime: { $gte: from, $lte: to },
        };

        const [meetings, total] = await Promise.all([
            CalendarEvent.find(query)
                .sort({ startTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            CalendarEvent.countDocuments(query),
        ]);

        return {
            meetings,
            total,
            page,
            pages: Math.ceil(total / limit),
        };
    }
}
