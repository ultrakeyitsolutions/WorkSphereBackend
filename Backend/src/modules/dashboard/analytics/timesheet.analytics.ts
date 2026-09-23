import { Attendance } from '../../attendance/attendance.model';
import { TimeTracking, IntervalType } from '../../task-tracking/time-tracking.model';
import { DashboardScopeContext, TimesheetAnalyticsResponse, TimesheetProjectBreakdown } from '../dashboard.types';

export class TimesheetAnalytics {
    public static async getTimesheetAnalytics(context: DashboardScopeContext): Promise<TimesheetAnalyticsResponse> {
        const { companyId, userId, isCompanyWide, accessibleProjectIds, filterProjectId, filterTeamId, dateRange } = context;

        const trackingMatch: any = { companyId };
        const attendanceMatch: any = { companyId };

        if (filterProjectId) {
            trackingMatch.projectId = filterProjectId;
        } else if (!isCompanyWide) {
            trackingMatch.projectId = { $in: accessibleProjectIds };
        }

        if (!isCompanyWide) {
            trackingMatch.userId = userId;
            attendanceMatch.userId = userId;
        } else if (filterTeamId) {
            trackingMatch.userId = filterTeamId;
            attendanceMatch.userId = filterTeamId;
        }

        if (dateRange.startDate && dateRange.endDate) {
            trackingMatch.startedAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
            attendanceMatch.checkInTime = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        const [attendanceLogs, trackingSessions, projectLoggedList] = await Promise.all([
            Attendance.find(attendanceMatch).lean(),
            TimeTracking.find(trackingMatch).lean(),
            TimeTracking.aggregate([
                { $match: trackingMatch },
                {
                    $group: {
                        _id: '$projectId',
                        totalSeconds: { $sum: '$workedSeconds' },
                    },
                },
                {
                    $lookup: {
                        from: 'projects',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'projectDoc',
                    },
                },
                {
                    $unwind: {
                        path: '$projectDoc',
                        preserveNullAndEmptyArrays: true,
                    },
                },
            ]),
        ]);

        let totalCheckedInMs = 0;
        let overtimeMs = 0;
        const STANDARD_DAY_MS = 8 * 60 * 60 * 1000;

        const userDayAttendance = new Map<string, number>();
        for (const att of attendanceLogs) {
            const start = new Date(att.checkInTime).getTime();
            const end = att.checkOutTime ? new Date(att.checkOutTime).getTime() : Date.now();
            const duration = Math.max(0, end - start);
            totalCheckedInMs += duration;

            const dayKey = `${att.userId}_${new Date(att.checkInTime).toISOString().split('T')[0]}`;
            userDayAttendance.set(dayKey, (userDayAttendance.get(dayKey) || 0) + duration);
        }

        for (const duration of userDayAttendance.values()) {
            if (duration > STANDARD_DAY_MS) {
                overtimeMs += duration - STANDARD_DAY_MS;
            }
        }

        let totalActiveMs = 0;
        let totalBreakMs = 0;

        for (const session of trackingSessions) {
            if (session.intervals && Array.isArray(session.intervals)) {
                for (const interval of session.intervals) {
                    const start = new Date(interval.startedAt).getTime();
                    const end = interval.endedAt ? new Date(interval.endedAt).getTime() : Date.now();
                    const duration = Math.max(0, end - start);

                    if (interval.type === IntervalType.WORK) {
                        totalActiveMs += duration;
                    } else {
                        totalBreakMs += duration;
                    }
                }
            } else if (session.workedSeconds) {
                totalActiveMs += session.workedSeconds * 1000;
            }
        }

        const totalWorkingMinutes = Math.round(Math.max(totalCheckedInMs, totalActiveMs + totalBreakMs) / 60000);
        const totalActiveMinutes = Math.round(totalActiveMs / 60000);
        const totalBreakMinutes = Math.round(totalBreakMs / 60000);
        const totalIdleMinutes = Math.max(0, totalWorkingMinutes - totalActiveMinutes - totalBreakMinutes);
        const overtimeMinutes = Math.round(overtimeMs / 60000);

        const byProject: TimesheetProjectBreakdown[] = projectLoggedList.map((p) => ({
            projectId: String(p._id),
            projectName: p.projectDoc?.name || 'Project',
            loggedMinutes: Math.round((p.totalSeconds || 0) / 60),
        }));

        return {
            totalWorkingMinutes,
            totalActiveMinutes,
            totalIdleMinutes,
            totalBreakMinutes,
            overtimeMinutes,
            byProject,
        };
    }
}
