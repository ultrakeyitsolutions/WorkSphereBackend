import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Attendance } from './attendance.model';
import { AttendanceEvent } from './attendance-event.model';
import {
    AttendanceStatus,
    AttendanceEventType,
    IAttendanceDocument,
    LeaveStatus,
    CheckInDto,
    CheckOutDto,
    BreakEventDto,
    CalendarQueryDto,
    AttendanceSummaryQueryDto,
    AdminAttendanceListQueryDto,
} from './attendance.types';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { TimezoneUtils } from './utils/timezone.utils';
import { LeaveRequest } from './leave.model';
import { Holiday } from './holiday.model';
import { NotificationEventBus } from '../notifications/notification.event-bus';
import CompanyMember from '../companyadmin/invitations/company-member.model';

export class AttendanceService {
    /**
     * POST /api/attendance/check-in
     * Evaluates shift, lateness, holidays, leaves, and records CHECK_IN event.
     */
    static async checkIn(
        companyId: string,
        employeeId: string,
        dto: CheckInDto = {},
        reqInfo?: { ip?: string; deviceId?: string; source?: string }
    ): Promise<{ attendance: IAttendanceDocument; event: any }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const punchTime = dto.timestamp ? new Date(dto.timestamp) : new Date();

        // 1. Resolve company timezone
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        // 2. Resolve shift schedule and cycle date boundaries (handles overnight shifts)
        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            punchTime,
            timezone
        );

        const { cycleDate, scheduledStartTime, scheduledEndTime, scheduledWorkingMinutes, gracePeriodMinutes, isOvernight } = shiftResolution;

        // 3. Resolve Holiday, Leave, and Week-Off
        const [holiday, leave] = await Promise.all([
            AttendanceCalculationService.resolveHoliday(companyId, cycleDate),
            AttendanceCalculationService.resolveLeave(companyId, employeeId, cycleDate),
        ]);
        const isWeekOff = AttendanceCalculationService.resolveWeekOff(cycleDate, shiftResolution.shift);

        // 4. Check for existing Attendance record for this cycle date
        let attendance = await Attendance.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            date: cycleDate,
        });

        // 5. Prevent duplicate open check-in
        if (attendance && attendance.actual?.firstCheckIn && !attendance.actual?.lastCheckOut) {
            throw AppError.conflict('An active check-in session is already open for today.');
        }

        // 6. Calculate Lateness
        const { lateMinutes, punchStatus } = AttendanceCalculationService.calculateLateMinutes(
            punchTime,
            scheduledStartTime,
            gracePeriodMinutes
        );

        // 7. Calculate Status
        const status = AttendanceCalculationService.calculateAttendanceStatus({
            hasCheckIn: true,
            hasCheckOut: false,
            workedMinutes: 0,
            scheduledWorkingMinutes,
            halfDayThresholdMinutes: (shiftResolution.shift as any)?.halfDayThresholdMinutes || 240,
            leave,
            holiday,
            isWeekOff,
            isShiftConcluded: false,
        });

        const firstCheckIn = attendance?.actual?.firstCheckIn || punchTime;

        if (!attendance) {
            attendance = await Attendance.create({
                companyId: companyObjId,
                employeeId: employeeObjId,
                date: cycleDate,
                status,
                shiftId: shiftResolution.shiftId,
                scheduled: {
                    startTime: scheduledStartTime,
                    endTime: scheduledEndTime,
                    workingMinutes: scheduledWorkingMinutes,
                },
                actual: {
                    firstCheckIn,
                    lastCheckOut: null,
                    workedMinutes: 0,
                },
                metrics: {
                    lateMinutes,
                    earlyLeaveMinutes: 0,
                    overtimeMinutes: 0,
                },
                leave: {
                    leaveId: leave?._id || null,
                    leaveType: leave?.leaveType || null,
                    durationType: leave?.durationType || null,
                },
                holiday: {
                    holidayId: holiday?._id || null,
                    holidayName: holiday?.name || null,
                },
                source: dto.source || reqInfo?.source || 'WEB',
                punchStatus,
                isOvernight,
                isFinalized: false,
                notes: dto.notes || '',
            });
        } else {
            attendance.status = status;
            attendance.actual.firstCheckIn = firstCheckIn;
            attendance.actual.lastCheckOut = null; // Re-opened session
            attendance.metrics.lateMinutes = lateMinutes;
            attendance.punchStatus = punchStatus;
            attendance.shiftId = shiftResolution.shiftId;
            attendance.isFinalized = false;
            await attendance.save();
        }

        // 8. Record AttendanceEvent (CHECK_IN)
        const event = await AttendanceEvent.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            attendanceId: attendance._id,
            type: AttendanceEventType.CHECK_IN,
            timestamp: punchTime,
            source: dto.source || reqInfo?.source || 'WEB',
            deviceId: dto.deviceId || reqInfo?.deviceId || null,
            ipAddress: reqInfo?.ip || null,
            location: dto.location || {},
            metadata: {
                punchStatus,
                lateMinutes,
                cycleDate,
            },
        });

        // 9. Fire notification event
        NotificationEventBus.getInstance().publish({
            type: 'ATTENDANCE_CHECK_IN',
            companyId,
            actorId: employeeId,
            entityId: attendance._id.toString(),
            entityType: 'ATTENDANCE',
            metadata: {
                punchStatus,
                lateMinutes,
                date: cycleDate,
            },
        });

        return { attendance, event };
    }

    /**
     * POST /api/attendance/check-out
     * Calculates workedMinutes, earlyDeparture, overtime, and records CHECK_OUT event.
     */
    static async checkOut(
        companyId: string,
        employeeId: string,
        dto: CheckOutDto = {},
        reqInfo?: { ip?: string; deviceId?: string; source?: string }
    ): Promise<{ attendance: IAttendanceDocument; event: any }> {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const punchTime = dto.timestamp ? new Date(dto.timestamp) : new Date();

        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        // Resolve shift schedule
        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            punchTime,
            timezone
        );

        // Find open attendance record
        const attendance = await Attendance.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            date: shiftResolution.cycleDate,
        });

        if (!attendance || !attendance.actual?.firstCheckIn) {
            throw AppError.conflict('No active check-in found for the current shift cycle.');
        }

        if (attendance.actual?.lastCheckOut) {
            throw AppError.conflict('Attendance has already been checked out for this shift cycle.');
        }

        // Calculate early departure / overtime metrics
        const { earlyLeaveMinutes, overtimeMinutes, checkoutStatus } =
            AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                punchTime,
                shiftResolution.scheduledEndTime,
                shiftResolution.earlyCheckoutGraceMinutes
            );

        // Calculate worked minutes
        const workedMinutes = AttendanceCalculationService.calculateWorkedMinutes(
            attendance.actual.firstCheckIn,
            punchTime,
            0
        );

        // Calculate final status
        const [holiday, leave] = await Promise.all([
            AttendanceCalculationService.resolveHoliday(companyId, shiftResolution.cycleDate),
            AttendanceCalculationService.resolveLeave(companyId, employeeId, shiftResolution.cycleDate),
        ]);
        const isWeekOff = AttendanceCalculationService.resolveWeekOff(
            shiftResolution.cycleDate,
            shiftResolution.shift
        );

        const status = AttendanceCalculationService.calculateAttendanceStatus({
            hasCheckIn: true,
            hasCheckOut: true,
            workedMinutes,
            scheduledWorkingMinutes: shiftResolution.scheduledWorkingMinutes,
            halfDayThresholdMinutes: (shiftResolution.shift as any)?.halfDayThresholdMinutes || 240,
            leave,
            holiday,
            isWeekOff,
            isShiftConcluded: true,
        });

        // Update attendance record
        attendance.actual.lastCheckOut = punchTime;
        attendance.actual.workedMinutes = workedMinutes;
        attendance.metrics.earlyLeaveMinutes = earlyLeaveMinutes;
        attendance.metrics.overtimeMinutes = overtimeMinutes;
        attendance.checkoutStatus = checkoutStatus;
        attendance.status = status;
        attendance.isFinalized = true;
        if (dto.notes) attendance.notes = dto.notes;

        await attendance.save();

        // Record AttendanceEvent (CHECK_OUT)
        const event = await AttendanceEvent.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            attendanceId: attendance._id,
            type: AttendanceEventType.CHECK_OUT,
            timestamp: punchTime,
            source: dto.source || reqInfo?.source || 'WEB',
            deviceId: dto.deviceId || reqInfo?.deviceId || null,
            ipAddress: reqInfo?.ip || null,
            location: dto.location || {},
            metadata: {
                workedMinutes,
                checkoutStatus,
                earlyLeaveMinutes,
                overtimeMinutes,
            },
        });

        // Fire notification event
        NotificationEventBus.getInstance().publish({
            type: 'ATTENDANCE_CHECK_OUT',
            companyId,
            actorId: employeeId,
            entityId: attendance._id.toString(),
            entityType: 'ATTENDANCE',
            metadata: {
                workDurationMinutes: workedMinutes,
                checkoutStatus,
                date: shiftResolution.cycleDate,
            },
        });

        return { attendance, event };
    }

    /**
     * Record Break Start / Break End event
     */
    static async recordBreak(
        companyId: string,
        employeeId: string,
        type: AttendanceEventType.BREAK_START | AttendanceEventType.BREAK_END,
        dto: BreakEventDto = {},
        reqInfo?: { ip?: string; source?: string }
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const employeeObjId = new Types.ObjectId(employeeId);
        const punchTime = dto.timestamp ? new Date(dto.timestamp) : new Date();

        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);
        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            punchTime,
            timezone
        );

        const attendance = await Attendance.findOne({
            companyId: companyObjId,
            employeeId: employeeObjId,
            date: shiftResolution.cycleDate,
        });

        if (!attendance) {
            throw AppError.conflict('No active attendance record found for today.');
        }

        const event = await AttendanceEvent.create({
            companyId: companyObjId,
            employeeId: employeeObjId,
            attendanceId: attendance._id,
            type,
            timestamp: punchTime,
            source: dto.source || reqInfo?.source || 'WEB',
            ipAddress: reqInfo?.ip || null,
        });

        return { attendance, event };
    }

    /**
     * GET /api/attendance/status
     * Gets current punch status, active shift, today's attendance & timeline events.
     */
    static async getCurrentStatus(companyId: string, employeeId: string) {
        const now = new Date();
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            now,
            timezone
        );

        const [attendance, events, holiday, leave] = await Promise.all([
            Attendance.findOne({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                date: shiftResolution.cycleDate,
            })
                .populate('shiftId', 'name code startTime endTime crossesMidnight workingDays timezone')
                .lean(),
            AttendanceEvent.find({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                timestamp: {
                    $gte: shiftResolution.scheduledStartTime,
                    $lte: new Date(shiftResolution.scheduledEndTime.getTime() + 4 * 3600 * 1000),
                },
            })
                .sort({ timestamp: 1 })
                .lean(),
            AttendanceCalculationService.resolveHoliday(companyId, shiftResolution.cycleDate),
            AttendanceCalculationService.resolveLeave(companyId, employeeId, shiftResolution.cycleDate),
        ]);

        const isWeekOff = AttendanceCalculationService.resolveWeekOff(
            shiftResolution.cycleDate,
            shiftResolution.shift
        );

        const isCheckedIn = !!(attendance?.actual?.firstCheckIn && !attendance?.actual?.lastCheckOut);

        return {
            date: shiftResolution.cycleDate,
            timezone,
            isCheckedIn,
            shift: shiftResolution.shift,
            attendance: attendance || null,
            events,
            holiday: holiday ? { id: holiday._id, name: holiday.name } : null,
            leave: leave ? { id: leave._id, type: leave.leaveType, durationType: leave.durationType } : null,
            isWeekOff,
        };
    }

    /**
     * GET /api/attendance/calendar
     * Returns daily calendar attendance state for an employee (range-limited to max 90 days).
     */
    static async getEmployeeCalendar(
        companyId: string,
        employeeId: string,
        query: CalendarQueryDto
    ) {
        let startDate: string;
        let endDate: string;

        if (query.year && query.month) {
            const m = String(query.month).padStart(2, '0');
            const lastDay = new Date(Number(query.year), Number(query.month), 0).getDate();
            startDate = `${query.year}-${m}-01`;
            endDate = `${query.year}-${m}-${String(lastDay).padStart(2, '0')}`;
        } else if (query.startDate && query.endDate) {
            startDate = query.startDate;
            endDate = query.endDate;
        } else {
            // Default to current month
            const now = new Date();
            const y = now.getUTCFullYear();
            const m = String(now.getUTCMonth() + 1).padStart(2, '0');
            const lastDay = new Date(y, now.getUTCMonth() + 1, 0).getDate();
            startDate = `${y}-${m}-01`;
            endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
        }

        const dateList = TimezoneUtils.getDateRangeArray(startDate, endDate);

        // Security / Performance: Enforce maximum date range limit
        if (dateList.length > 90) {
            throw AppError.badRequest('Calendar date range cannot exceed 90 days per query.');
        }

        const [attendanceRecords, holidays, leaves, resolvedShift] = await Promise.all([
            Attendance.find({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                date: { $gte: startDate, $lte: endDate },
            })
                .populate('shiftId', 'name code startTime endTime crossesMidnight')
                .lean(),
            Holiday.find({
                companyId: new Types.ObjectId(companyId),
                date: { $gte: startDate, $lte: endDate },
            }).lean(),
            LeaveRequest.find({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                status: LeaveStatus.APPROVED,
                startDate: { $lte: endDate },
                endDate: { $gte: startDate },
            }).lean(),
            AttendanceCalculationService.resolveShiftSchedule(
                companyId,
                employeeId,
                new Date(`${startDate}T12:00:00Z`)
            ),
        ]);

        const attendanceMap = new Map<string, any>();
        attendanceRecords.forEach((att) => attendanceMap.set(att.date, att));

        const holidayMap = new Map<string, any>();
        holidays.forEach((h) => holidayMap.set(h.date, h));

        // Construct daily timeline
        const days = dateList.map((dateStr) => {
            const att = attendanceMap.get(dateStr);
            const hol = holidayMap.get(dateStr);
            const lev = leaves.find((l) => l.startDate <= dateStr && l.endDate >= dateStr);
            const isWeekOff = AttendanceCalculationService.resolveWeekOff(dateStr, resolvedShift.shift);

            let dayStatus = att?.status || AttendanceStatus.PENDING;
            if (!att) {
                if (hol) dayStatus = AttendanceStatus.HOLIDAY;
                else if (lev) dayStatus = lev.durationType === 'HALF_DAY' ? AttendanceStatus.HALF_DAY : AttendanceStatus.LEAVE;
                else if (isWeekOff) dayStatus = AttendanceStatus.WEEK_OFF;
            }

            return {
                date: dateStr,
                status: dayStatus,
                shift: att?.shiftId || resolvedShift.shift,
                checkIn: att?.actual?.firstCheckIn || null,
                checkOut: att?.actual?.lastCheckOut || null,
                workedMinutes: att?.actual?.workedMinutes || 0,
                lateMinutes: att?.metrics?.lateMinutes || 0,
                earlyLeaveMinutes: att?.metrics?.earlyLeaveMinutes || 0,
                overtimeMinutes: att?.metrics?.overtimeMinutes || 0,
                punchStatus: att?.punchStatus || 'ON_TIME',
                checkoutStatus: att?.checkoutStatus || 'ON_TIME',
                leave: lev ? { id: lev._id, type: lev.leaveType, durationType: lev.durationType } : null,
                holiday: hol ? { id: hol._id, name: hol.name } : null,
                isWeekOff,
            };
        });

        return {
            startDate,
            endDate,
            totalDays: days.length,
            days,
        };
    }

    /**
     * GET /api/attendance/summary
     * Computes high-level aggregated attendance counts and metrics.
     */
    static async getEmployeeSummary(
        companyId: string,
        employeeId: string,
        query: AttendanceSummaryQueryDto
    ) {
        let startDate: string;
        let endDate: string;

        if (query.year && query.month) {
            const m = String(query.month).padStart(2, '0');
            const lastDay = new Date(Number(query.year), Number(query.month), 0).getDate();
            startDate = `${query.year}-${m}-01`;
            endDate = `${query.year}-${m}-${String(lastDay).padStart(2, '0')}`;
        } else if (query.startDate && query.endDate) {
            startDate = query.startDate;
            endDate = query.endDate;
        } else {
            // Default 30-day window
            const now = new Date();
            const y = now.getUTCFullYear();
            const m = String(now.getUTCMonth() + 1).padStart(2, '0');
            const lastDay = new Date(y, now.getUTCMonth() + 1, 0).getDate();
            startDate = `${y}-${m}-01`;
            endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
        }

        const dateList = TimezoneUtils.getDateRangeArray(startDate, endDate);

        const records = await Attendance.find({
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
            date: { $gte: startDate, $lte: endDate },
        }).lean();

        let presentDays = 0;
        let absentDays = 0;
        let leaveDays = 0;
        let holidayDays = 0;
        let weekOffDays = 0;
        let halfDays = 0;
        let lateDays = 0;
        let earlyLeaveDays = 0;
        let totalWorkedMinutes = 0;
        let totalOvertimeMinutes = 0;

        for (const rec of records) {
            if (rec.status === AttendanceStatus.PRESENT) presentDays++;
            else if (rec.status === AttendanceStatus.ABSENT) absentDays++;
            else if (rec.status === AttendanceStatus.LEAVE) leaveDays++;
            else if (rec.status === AttendanceStatus.HOLIDAY) holidayDays++;
            else if (rec.status === AttendanceStatus.WEEK_OFF) weekOffDays++;
            else if (rec.status === AttendanceStatus.HALF_DAY) {
                halfDays++;
                presentDays += 0.5;
            }

            if ((rec.metrics?.lateMinutes || 0) > 0) lateDays++;
            if ((rec.metrics?.earlyLeaveMinutes || 0) > 0) earlyLeaveDays++;
            totalWorkedMinutes += rec.actual?.workedMinutes || 0;
            totalOvertimeMinutes += rec.metrics?.overtimeMinutes || 0;
        }

        const workingDaysInPeriod = Math.max(1, dateList.length - holidayDays - weekOffDays);
        const attendancePercentage = Math.round((presentDays / workingDaysInPeriod) * 10000) / 100;

        return {
            startDate,
            endDate,
            totalPeriodDays: dateList.length,
            presentDays,
            absentDays,
            leaveDays,
            holidayDays,
            weekOffDays,
            halfDays,
            lateDays,
            earlyLeaveDays,
            totalWorkedMinutes,
            totalOvertimeMinutes,
            attendancePercentage,
        };
    }

    /**
     * GET /api/admin/attendance
     * Admin Dashboard: Paginated list of summarized employee rows for a date.
     */
    static async getAdminAttendanceList(
        companyId: string,
        query: AdminAttendanceListQueryDto
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);
        const targetDate = query.date || TimezoneUtils.formatDateInTimezone(new Date(), timezone);

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        // 1. Fetch active company members with search / department filter
        const memberMatch: Record<string, any> = {
            companyId: companyObjId,
            status: 'ACTIVE',
        };

        if (query.employeeId) {
            memberMatch.userId = new Types.ObjectId(query.employeeId);
        }

        const [members, totalMembers] = await Promise.all([
            CompanyMember.find(memberMatch)
                .skip(skip)
                .limit(limit)
                .populate('userId', 'name email avatar status')
                .populate('roleId', 'name displayName')
                .populate('designationId', 'title')
                .lean(),
            CompanyMember.countDocuments(memberMatch),
        ]);

        const employeeIds = members.map((m) => m.userId?._id).filter(Boolean);

        // 2. Fetch Attendance for targetDate for these employees
        const attendanceRecords = await Attendance.find({
            companyId: companyObjId,
            employeeId: { $in: employeeIds },
            date: targetDate,
        })
            .populate('shiftId', 'name code startTime endTime')
            .lean();

        const attendanceMap = new Map<string, any>();
        attendanceRecords.forEach((att) => attendanceMap.set(att.employeeId.toString(), att));

        // 3. Resolve Holiday for targetDate
        const holiday = await AttendanceCalculationService.resolveHoliday(companyId, targetDate);

        // 4. Build summarized rows
        const rows = members.map((m) => {
            const empUser: any = m.userId || {};
            const empIdStr = empUser._id?.toString() || '';
            const att = attendanceMap.get(empIdStr);

            let status = att?.status || AttendanceStatus.PENDING;
            if (!att && holiday) {
                status = AttendanceStatus.HOLIDAY;
            }

            const workedHours = att?.actual?.workedMinutes
                ? Math.round((att.actual.workedMinutes / 60) * 100) / 100
                : 0;

            return {
                employee: {
                    id: empIdStr,
                    name: empUser.name || 'Unknown',
                    email: empUser.email || '',
                    avatar: empUser.avatar || null,
                    role: (m.roleId as any)?.name || 'EMPLOYEE',
                    designation: (m.designationId as any)?.title || 'Member',
                },
                date: targetDate,
                status,
                shift: att?.shiftId || null,
                checkIn: att?.actual?.firstCheckIn || null,
                checkOut: att?.actual?.lastCheckOut || null,
                workedHours,
                lateMinutes: att?.metrics?.lateMinutes || 0,
                earlyLeaveMinutes: att?.metrics?.earlyLeaveMinutes || 0,
                punchStatus: att?.punchStatus || 'ON_TIME',
            };
        });

        // Filter by status if query parameter specified
        const filteredRows = query.status ? rows.filter((r) => r.status === query.status) : rows;

        return {
            date: targetDate,
            timezone,
            employees: filteredRows,
            pagination: {
                total: totalMembers,
                page,
                limit,
                pages: Math.ceil(totalMembers / limit),
            },
        };
    }

    /**
     * Daily attendance finalization process for a company.
     * Ensures employees who did not punch in are evaluated (Holiday -> Leave -> WeekOff -> ABSENT).
     */
    static async finalizeDailyAttendance(companyId: string, targetDateStr?: string) {
        const companyObjId = new Types.ObjectId(companyId);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);
        const dateStr = targetDateStr || TimezoneUtils.formatDateInTimezone(new Date(), timezone);

        const members = await CompanyMember.find({
            companyId: companyObjId,
            status: 'ACTIVE',
        })
            .select('userId')
            .lean();

        let finalizedCount = 0;
        const [holiday, companyLeaves] = await Promise.all([
            AttendanceCalculationService.resolveHoliday(companyId, dateStr),
            LeaveRequest.find({
                companyId: companyObjId,
                status: LeaveStatus.APPROVED,
                startDate: { $lte: dateStr },
                endDate: { $gte: dateStr },
            }).lean(),
        ]);

        for (const member of members) {
            const empIdStr = member.userId.toString();
            const existing = await Attendance.findOne({
                companyId: companyObjId,
                employeeId: member.userId,
                date: dateStr,
            });

            if (existing && existing.actual?.firstCheckIn) {
                // Already punched in, ensure finalized flag is set if check-out occurred
                if (existing.actual.lastCheckOut && !existing.isFinalized) {
                    existing.isFinalized = true;
                    await existing.save();
                    finalizedCount++;
                }
                continue;
            }

            const leave = companyLeaves.find((l: any) => l.employeeId.toString() === empIdStr) || null;
            const shiftRes = await AttendanceCalculationService.resolveShiftSchedule(
                companyId,
                empIdStr,
                new Date(`${dateStr}T12:00:00Z`),
                timezone
            );
            const isWeekOff = AttendanceCalculationService.resolveWeekOff(dateStr, shiftRes.shift);

            const finalStatus = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: false,
                hasCheckOut: false,
                workedMinutes: 0,
                scheduledWorkingMinutes: shiftRes.scheduledWorkingMinutes,
                halfDayThresholdMinutes: (shiftRes.shift as any)?.halfDayThresholdMinutes || 240,
                leave: leave as any,
                holiday,
                isWeekOff,
                isShiftConcluded: true,
            });

            await Attendance.findOneAndUpdate(
                {
                    companyId: companyObjId,
                    employeeId: member.userId,
                    date: dateStr,
                },
                {
                    $set: {
                        status: finalStatus,
                        shiftId: shiftRes.shiftId,
                        scheduled: {
                            startTime: shiftRes.scheduledStartTime,
                            endTime: shiftRes.scheduledEndTime,
                            workingMinutes: shiftRes.scheduledWorkingMinutes,
                        },
                        leave: {
                            leaveId: leave?._id || null,
                            leaveType: leave?.leaveType || null,
                            durationType: leave?.durationType || null,
                        },
                        holiday: {
                            holidayId: holiday?._id || null,
                            holidayName: holiday?.name || null,
                        },
                        source: 'AUTO',
                        isFinalized: true,
                    },
                    $setOnInsert: {
                        actual: { firstCheckIn: null, lastCheckOut: null, workedMinutes: 0 },
                        metrics: { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                    },
                },
                { upsert: true, new: true }
            );

            finalizedCount++;
        }

        return {
            success: true,
            date: dateStr,
            totalMembers: members.length,
            finalizedCount,
        };
    }
}
