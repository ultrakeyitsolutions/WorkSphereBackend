import { Types } from 'mongoose';
import { Attendance } from '../../attendance/attendance.model';
import { AttendanceAnalyticsResponse, DashboardScopeContext } from '../dashboard.types';

export class AttendanceAnalytics {
    public static async getAttendanceAnalytics(
        context: DashboardScopeContext,
        activeEmployees: number
    ): Promise<AttendanceAnalyticsResponse> {
        const { companyId, userId, isCompanyWide, dateRange, filterTeamId } = context;

        const match: any = { companyId };

        if (!isCompanyWide) {
            match.userId = userId;
        } else if (filterTeamId) {
            match.userId = filterTeamId;
        }

        if (dateRange.startDate && dateRange.endDate) {
            match.checkInTime = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        const attendanceLogs = await Attendance.find(match).lean();

        if (!isCompanyWide) {
            // Employee Personal Attendance
            const presentDaysSet = new Set<string>();
            let lateCount = 0;

            for (const log of attendanceLogs) {
                const dayStr = new Date(log.checkInTime).toISOString().split('T')[0];
                presentDaysSet.add(dayStr);

                const checkIn = new Date(log.checkInTime);
                if (checkIn.getHours() >= 10 && checkIn.getMinutes() > 0) {
                    lateCount++;
                }
            }

            const present = presentDaysSet.size;
            const totalDays = dateRange.days.length || 1;
            const onLeave = 0;
            const absent = Math.max(0, totalDays - present - onLeave);
            const attendancePercentage = totalDays > 0
                ? Math.round((present / totalDays) * 10000) / 100
                : 0;

            return {
                present,
                absent,
                onLeave,
                late: lateCount,
                attendancePercentage,
            };
        }

        // Company-Wide Attendance
        const presentUserSet = new Set<string>();
        let lateCount = 0;

        for (const log of attendanceLogs) {
            presentUserSet.add(String(log.userId));

            const checkIn = new Date(log.checkInTime);
            if (checkIn.getHours() >= 10 && checkIn.getMinutes() > 0) {
                lateCount++;
            }
        }

        const present = presentUserSet.size;
        const onLeave = 0;
        const absent = Math.max(0, activeEmployees - present - onLeave);
        const attendancePercentage = activeEmployees > 0
            ? Math.round((present / activeEmployees) * 10000) / 100
            : 0;

        return {
            present,
            absent,
            onLeave,
            late: lateCount,
            attendancePercentage,
        };
    }
}
