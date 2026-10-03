import { Types } from 'mongoose';
import { Attendance } from './attendance.model';
import { AttendanceStatus } from './attendance.types';
import CompanyMember from '../companyadmin/invitations/company-member.model';
import { TimezoneUtils } from './utils/timezone.utils';

export interface ReportSummaryMetrics {
    totalRecords: number;
    presentCount: number;
    absentCount: number;
    halfDayCount: number;
    leaveCount: number;
    holidayCount: number;
    weekOffCount: number;
    lateArrivals: number;
    earlyDepartures: number;
    totalWorkedMinutes: number;
    totalOvertimeMinutes: number;
    averageWorkingHours: number;
    attendancePercentage: number;
    presentPercentage: number;
    absencePercentage: number;
    leavePercentage: number;
}

export class AttendanceReportService {
    /**
     * Helper to compute consolidated percentages from raw aggregation totals.
     */
    private static formatSummaryMetrics(aggResult: any, expectedTotalDaysOrStaff: number): ReportSummaryMetrics {
        const total = aggResult?.totalRecords || 0;
        const present = aggResult?.presentCount || 0;
        const absent = aggResult?.absentCount || 0;
        const halfDay = aggResult?.halfDayCount || 0;
        const leave = aggResult?.leaveCount || 0;
        const holiday = aggResult?.holidayCount || 0;
        const weekOff = aggResult?.weekOffCount || 0;
        const late = aggResult?.lateArrivals || 0;
        const early = aggResult?.earlyDepartures || 0;
        const totalWorked = aggResult?.totalWorkedMinutes || 0;
        const totalOvertime = aggResult?.totalOvertimeMinutes || 0;

        const effectivePresent = present + halfDay * 0.5;
        const divisor = expectedTotalDaysOrStaff > 0 ? expectedTotalDaysOrStaff : total || 1;

        const attendancePercentage = Math.round((effectivePresent / divisor) * 10000) / 100;
        const presentPercentage = Math.round((present / divisor) * 10000) / 100;
        const absencePercentage = Math.round((absent / divisor) * 10000) / 100;
        const leavePercentage = Math.round((leave / divisor) * 10000) / 100;

        const effectiveWorkedRecords = present + halfDay;
        const averageWorkingMinutes = effectiveWorkedRecords > 0 ? totalWorked / effectiveWorkedRecords : 0;
        const averageWorkingHours = Math.round((averageWorkingMinutes / 60) * 100) / 100;

        return {
            totalRecords: total,
            presentCount: present,
            absentCount: absent,
            halfDayCount: halfDay,
            leaveCount: leave,
            holidayCount: holiday,
            weekOffCount: weekOff,
            lateArrivals: late,
            earlyDepartures: early,
            totalWorkedMinutes: totalWorked,
            totalOvertimeMinutes: totalOvertime,
            averageWorkingHours,
            attendancePercentage,
            presentPercentage,
            absencePercentage,
            leavePercentage,
        };
    }

    /**
     * Daily attendance report using MongoDB aggregation pipeline.
     */
    static async getDailyReport(companyId: string, dateStr: string) {
        const companyObjId = new Types.ObjectId(companyId);

        // Get count of active employees in company
        const totalActiveEmployees = await CompanyMember.countDocuments({
            companyId: companyObjId,
            status: 'ACTIVE',
        });

        const pipeline = [
            {
                $match: {
                    companyId: companyObjId,
                    date: dateStr,
                },
            },
            {
                $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    presentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] },
                    },
                    absentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] },
                    },
                    halfDayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HALF_DAY] }, 1, 0] },
                    },
                    leaveCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.LEAVE] }, 1, 0] },
                    },
                    holidayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HOLIDAY] }, 1, 0] },
                    },
                    weekOffCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.WEEK_OFF] }, 1, 0] },
                    },
                    lateArrivals: {
                        $sum: { $cond: [{ $gt: ['$metrics.lateMinutes', 0] }, 1, 0] },
                    },
                    earlyDepartures: {
                        $sum: { $cond: [{ $gt: ['$metrics.earlyLeaveMinutes', 0] }, 1, 0] },
                    },
                    totalWorkedMinutes: { $sum: { $ifNull: ['$actual.workedMinutes', 0] } },
                    totalOvertimeMinutes: { $sum: { $ifNull: ['$metrics.overtimeMinutes', 0] } },
                },
            },
        ];

        const [aggResult] = await Attendance.aggregate(pipeline);
        const summary = this.formatSummaryMetrics(aggResult, totalActiveEmployees);

        return {
            date: dateStr,
            totalActiveEmployees,
            summary,
        };
    }

    /**
     * Weekly attendance report aggregated across a date range.
     */
    static async getWeeklyReport(companyId: string, startDate: string, endDate: string) {
        const companyObjId = new Types.ObjectId(companyId);

        const totalActiveEmployees = await CompanyMember.countDocuments({
            companyId: companyObjId,
            status: 'ACTIVE',
        });

        const dateList = TimezoneUtils.getDateRangeArray(startDate, endDate);
        const expectedTotalStaffDays = totalActiveEmployees * dateList.length;

        // Overall summary pipeline
        const summaryPipeline = [
            {
                $match: {
                    companyId: companyObjId,
                    date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    presentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] },
                    },
                    absentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] },
                    },
                    halfDayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HALF_DAY] }, 1, 0] },
                    },
                    leaveCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.LEAVE] }, 1, 0] },
                    },
                    holidayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HOLIDAY] }, 1, 0] },
                    },
                    weekOffCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.WEEK_OFF] }, 1, 0] },
                    },
                    lateArrivals: {
                        $sum: { $cond: [{ $gt: ['$metrics.lateMinutes', 0] }, 1, 0] },
                    },
                    earlyDepartures: {
                        $sum: { $cond: [{ $gt: ['$metrics.earlyLeaveMinutes', 0] }, 1, 0] },
                    },
                    totalWorkedMinutes: { $sum: { $ifNull: ['$actual.workedMinutes', 0] } },
                    totalOvertimeMinutes: { $sum: { $ifNull: ['$metrics.overtimeMinutes', 0] } },
                },
            },
        ];

        // Day-by-day trend breakdown pipeline
        const dailyTrendPipeline: any[] = [
            {
                $match: {
                    companyId: companyObjId,
                    date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: '$date',
                    date: { $first: '$date' },
                    present: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] },
                    },
                    absent: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] },
                    },
                    leave: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.LEAVE] }, 1, 0] },
                    },
                    late: {
                        $sum: { $cond: [{ $gt: ['$metrics.lateMinutes', 0] }, 1, 0] },
                    },
                    totalWorkedMinutes: { $sum: { $ifNull: ['$actual.workedMinutes', 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ];

        const [[summaryResult], dailyTrend] = await Promise.all([
            Attendance.aggregate(summaryPipeline),
            Attendance.aggregate(dailyTrendPipeline),
        ]);

        const summary = this.formatSummaryMetrics(summaryResult, expectedTotalStaffDays);

        return {
            startDate,
            endDate,
            totalActiveEmployees,
            expectedTotalStaffDays,
            summary,
            dailyTrend,
        };
    }

    /**
     * Monthly attendance report aggregated for an entire month.
     */
    static async getMonthlyReport(companyId: string, year: number | string, month: number | string) {
        const formattedMonth = String(month).padStart(2, '0');
        const monthPrefix = `${year}-${formattedMonth}`;
        const startDate = `${monthPrefix}-01`;
        const lastDay = new Date(Number(year), Number(month), 0).getDate();
        const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

        return await this.getWeeklyReport(companyId, startDate, endDate);
    }

    /**
     * Aggregated report for a single employee over a custom range.
     */
    static async getEmployeeReport(
        companyId: string,
        employeeId: string,
        startDate: string,
        endDate: string
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const dateList = TimezoneUtils.getDateRangeArray(startDate, endDate);

        const pipeline = [
            {
                $match: {
                    companyId: companyObjId,
                    employeeId: employeeObjId,
                    date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: '$employeeId',
                    totalRecords: { $sum: 1 },
                    presentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] },
                    },
                    absentCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] },
                    },
                    halfDayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HALF_DAY] }, 1, 0] },
                    },
                    leaveCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.LEAVE] }, 1, 0] },
                    },
                    holidayCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.HOLIDAY] }, 1, 0] },
                    },
                    weekOffCount: {
                        $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.WEEK_OFF] }, 1, 0] },
                    },
                    lateArrivals: {
                        $sum: { $cond: [{ $gt: ['$metrics.lateMinutes', 0] }, 1, 0] },
                    },
                    earlyDepartures: {
                        $sum: { $cond: [{ $gt: ['$metrics.earlyLeaveMinutes', 0] }, 1, 0] },
                    },
                    totalWorkedMinutes: { $sum: { $ifNull: ['$actual.workedMinutes', 0] } },
                    totalOvertimeMinutes: { $sum: { $ifNull: ['$metrics.overtimeMinutes', 0] } },
                },
            },
        ];

        const [aggResult] = await Attendance.aggregate(pipeline);
        const summary = this.formatSummaryMetrics(aggResult, dateList.length);

        return {
            employeeId,
            startDate,
            endDate,
            totalDays: dateList.length,
            summary,
        };
    }
}
