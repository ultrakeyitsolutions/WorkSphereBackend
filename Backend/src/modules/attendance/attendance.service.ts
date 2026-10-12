import { Types, PipelineStage } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Attendance } from './attendance.model';
import { AttendanceEvent } from './attendance-event.model';
import {
    AttendanceStatus,
    AttendanceEventType,
    IAttendanceDocument,
    LeaveStatus,
    PunchStatus,
    CheckInDto,
    CheckOutDto,
    BreakEventDto,
    CalendarQueryDto,
    AttendanceSummaryQueryDto,
    AdminAttendanceListQueryDto,
    CompanyAttendanceSummaryQueryDto,
    LateArrivalsQueryDto,
    CompanyAttendanceRecordsQueryDto,
    MemberAttendanceHistoryQueryDto,
} from './attendance.types';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { TimezoneUtils } from './utils/timezone.utils';
import { LeaveRequest } from './leave.model';
import { Holiday } from './holiday.model';
import { AttendanceAdjustment } from './attendance-adjustment.model';
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
        // Authoritative server-generated timestamp
        const punchTime = new Date();

        // 1. Resolve company timezone
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        // 2. Resolve shift schedule and cycle date boundaries (handles overnight shifts)
        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            punchTime,
            timezone
        );

        const {
            cycleDate,
            scheduledStartTime,
            scheduledEndTime,
            scheduledWorkingMinutes,
            gracePeriodMinutes,
            isOvernight,
            shiftName,
            shiftCode,
            earlyCheckoutGraceMinutes,
            isAssigned,
        } = shiftResolution;

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

        // 5. Prevent duplicate open check-in / Idempotent retry handling
        if (attendance && attendance.actual?.firstCheckIn && !attendance.actual?.lastCheckOut) {
            // If requested within 5 seconds of the recorded check-in, treat as idempotent retry
            const diffMs = Math.abs(punchTime.getTime() - attendance.actual.firstCheckIn.getTime());
            if (diffMs < 5000) {
                return { attendance, event: null };
            }
            throw AppError.conflict('An active check-in session is already open for today.');
        }

        // 6. Calculate Lateness (only if shift is assigned)
        const { lateMinutes, punchStatus } = isAssigned && scheduledStartTime
            ? AttendanceCalculationService.calculateLateMinutes(
                  punchTime,
                  scheduledStartTime,
                  gracePeriodMinutes
              )
            : { lateMinutes: 0, punchStatus: 'ON_TIME' as PunchStatus };

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
            hasAssignedShift: isAssigned,
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
                    shiftName,
                    shiftCode,
                    gracePeriodMinutes,
                    earlyCheckoutGraceMinutes,
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
            if (attendance.scheduled) {
                attendance.scheduled.shiftName = shiftName;
                attendance.scheduled.shiftCode = shiftCode;
                attendance.scheduled.gracePeriodMinutes = gracePeriodMinutes;
                attendance.scheduled.earlyCheckoutGraceMinutes = earlyCheckoutGraceMinutes;
            }
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
        // Authoritative server-generated timestamp
        const punchTime = new Date();

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
            const diffMs = Math.abs(punchTime.getTime() - attendance.actual.lastCheckOut.getTime());
            if (diffMs < 5000) {
                return { attendance, event: null };
            }
            throw AppError.conflict('Attendance has already been checked out for this shift cycle.');
        }

        if (punchTime.getTime() < attendance.actual.firstCheckIn.getTime()) {
            throw AppError.badRequest('Check-out timestamp cannot be earlier than check-in timestamp.');
        }

        // Calculate break minutes from recorded break events
        const breakEvents = await AttendanceEvent.find({
            attendanceId: attendance._id,
            companyId: companyObjId,
            type: { $in: [AttendanceEventType.BREAK_START, AttendanceEventType.BREAK_END] },
        })
            .sort({ timestamp: 1 })
            .lean();

        let breakMinutes = 0;
        let activeBreakStart: Date | null = null;
        for (const ev of breakEvents) {
            if (ev.type === AttendanceEventType.BREAK_START) {
                activeBreakStart = ev.timestamp;
            } else if (ev.type === AttendanceEventType.BREAK_END && activeBreakStart) {
                const diff = Math.max(0, Math.round((ev.timestamp.getTime() - activeBreakStart.getTime()) / (60 * 1000)));
                breakMinutes += diff;
                activeBreakStart = null;
            }
        }
        if (activeBreakStart) {
            breakMinutes += Math.max(0, Math.round((punchTime.getTime() - activeBreakStart.getTime()) / (60 * 1000)));
        }

        // Calculate early departure / overtime metrics
        const { earlyLeaveMinutes, overtimeMinutes, checkoutStatus } =
            AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                punchTime,
                shiftResolution.scheduledEndTime,
                shiftResolution.earlyCheckoutGraceMinutes
            );

        // Calculate worked minutes net of breaks
        const workedMinutes = AttendanceCalculationService.calculateWorkedMinutes(
            attendance.actual.firstCheckIn,
            punchTime,
            breakMinutes
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
                    $gte: shiftResolution.scheduledStartTime || new Date(now.setHours(0, 0, 0, 0)),
                    $lte: shiftResolution.scheduledEndTime
                        ? new Date(shiftResolution.scheduledEndTime.getTime() + 4 * 3600 * 1000)
                        : new Date(),
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

    // ─── Phase 5: Company Admin Attendance Analytics Methods ────────────────────

    /**
     * GET /api/v1/company/attendance/summary
     * Computes real-time company attendance summary for a single date or bounded range.
     * All percentages feature mathematically defined and safe denominators.
     */
    static async getCompanyAttendanceSummary(
        companyId: string,
        query: CompanyAttendanceSummaryQueryDto
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        const isRange = !!(query.startDate && query.endDate);
        let startDate: string;
        let endDate: string;

        if (isRange) {
            startDate = String(query.startDate);
            endDate = String(query.endDate);
        } else {
            const d = query.date || TimezoneUtils.formatDateInTimezone(new Date(), timezone);
            startDate = d;
            endDate = d;
        }

        // Bounded date range protection: max 90 days
        const dateList = TimezoneUtils.getDateRangeArray(startDate, endDate);
        if (dateList.length > 90) {
            throw AppError.badRequest('Attendance summary date range cannot exceed 90 days.');
        }

        const memberFilter: Record<string, any> = {
            companyId: companyObjId,
            status: 'ACTIVE',
        };

        if (query.departmentId && Types.ObjectId.isValid(query.departmentId)) {
            memberFilter.designationId = new Types.ObjectId(query.departmentId);
        }

        const [activeMembers, records] = await Promise.all([
            CompanyMember.find(memberFilter).select('userId').lean(),
            Attendance.find({
                companyId: companyObjId,
                date: { $gte: startDate, $lte: endDate },
            }).lean(),
        ]);

        const validEmployeeIds = new Set(activeMembers.map((m) => m.userId.toString()));
        const filteredRecords = query.departmentId
            ? records.filter((r) => validEmployeeIds.has(r.employeeId.toString()))
            : records;

        let checkedInEmployees = 0;
        let onTimeEmployees = 0;
        let lateEmployees = 0;
        let earlyDepartureEmployees = 0;
        let incompleteAttendance = 0;
        let onApprovedLeave = 0;
        let onHoliday = 0;
        let onWeekOff = 0;
        let absentEmployees = 0;
        let totalWorkedMinutes = 0;

        for (const rec of filteredRecords) {
            const hasCheckIn = !!rec.actual?.firstCheckIn;
            const hasCheckOut = !!rec.actual?.lastCheckOut;

            if (hasCheckIn) {
                checkedInEmployees++;
                if ((rec.metrics?.lateMinutes || 0) > 0) {
                    lateEmployees++;
                } else {
                    onTimeEmployees++;
                }

                if (hasCheckOut) {
                    if ((rec.metrics?.earlyLeaveMinutes || 0) > 0) {
                        earlyDepartureEmployees++;
                    }
                    totalWorkedMinutes += rec.actual?.workedMinutes || 0;
                } else {
                    incompleteAttendance++;
                }
            } else {
                if (rec.status === AttendanceStatus.LEAVE || rec.status === AttendanceStatus.HALF_DAY) {
                    onApprovedLeave++;
                } else if (rec.status === AttendanceStatus.HOLIDAY) {
                    onHoliday++;
                } else if (rec.status === AttendanceStatus.WEEK_OFF) {
                    onWeekOff++;
                } else if (rec.status === AttendanceStatus.ABSENT) {
                    absentEmployees++;
                }
            }
        }

        // In a multi-day range, total scheduled instances = active employees * number of dates
        const scheduledEmployees = isRange
            ? activeMembers.length * dateList.length
            : activeMembers.length;

        const totalActualWorkedHours = Math.round((totalWorkedMinutes / 60) * 100) / 100;

        // Denominators explicitly defined
        const attendanceRatePercentage = scheduledEmployees > 0
            ? Math.round((checkedInEmployees / scheduledEmployees) * 10000) / 100
            : 0;

        const onTimeRatePercentage = checkedInEmployees > 0
            ? Math.round((onTimeEmployees / checkedInEmployees) * 10000) / 100
            : 0;

        const lateRatePercentage = checkedInEmployees > 0
            ? Math.round((lateEmployees / checkedInEmployees) * 10000) / 100
            : 0;

        return {
            date: isRange ? undefined : startDate,
            startDate,
            endDate,
            isRange,
            timezone,
            metrics: {
                scheduledEmployees,
                checkedInEmployees,
                onTimeEmployees,
                lateEmployees,
                earlyDepartureEmployees,
                incompleteAttendance,
                onApprovedLeave,
                onHoliday,
                onWeekOff,
                absentEmployees,
                totalActualWorkedHours,
                totalActualWorkedMinutes: totalWorkedMinutes,
                attendanceRatePercentage,
                onTimeRatePercentage,
                lateRatePercentage,
            },
        };
    }

    /**
     * GET /api/v1/company/attendance/late-arrivals
     * Returns top late arrival employees ranked by late minutes with deterministic tie-breaking.
     */
    static async getCompanyLateArrivals(companyId: string, query: LateArrivalsQueryDto) {
        const companyObjId = new Types.ObjectId(companyId);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        const limit = Math.min(50, Math.max(1, Number(query.limit) || 5));
        const page = Math.max(1, Number(query.page) || 1);
        const skip = (page - 1) * limit;

        const isRange = !!(query.startDate && query.endDate);
        const dateMatch: Record<string, any> = {
            companyId: companyObjId,
            'metrics.lateMinutes': { $gt: 0 },
            'actual.firstCheckIn': { $ne: null }, // Do not rank missing checkouts without check-in
        };

        if (isRange) {
            dateMatch.date = { $gte: String(query.startDate), $lte: String(query.endDate) };
        } else {
            const targetDate = query.date || TimezoneUtils.formatDateInTimezone(new Date(), timezone);
            dateMatch.date = targetDate;
        }

        if (query.departmentId && Types.ObjectId.isValid(query.departmentId)) {
            const deptMembers = await CompanyMember.find({
                companyId: companyObjId,
                designationId: new Types.ObjectId(query.departmentId),
            }).select('userId').lean();
            dateMatch.employeeId = { $in: deptMembers.map((m) => m.userId) };
        }

        if (!isRange) {
            // Single Date: Ranked by late minutes descending for that date
            const [records, total] = await Promise.all([
                Attendance.find(dateMatch)
                    .sort({ 'metrics.lateMinutes': -1, createdAt: 1 })
                    .skip(skip)
                    .limit(limit)
                    .populate('employeeId', 'name email avatar')
                    .populate('shiftId', 'name code startTime endTime')
                    .lean(),
                Attendance.countDocuments(dateMatch),
            ]);

            const items = records.map((rec: any, idx: number) => {
                const emp = rec.employeeId || {};
                const shift = rec.shiftId || {};
                return {
                    rank: skip + idx + 1,
                    attendanceId: rec._id.toString(),
                    employeeId: emp._id ? emp._id.toString() : rec.employeeId?.toString(),
                    employeeName: emp.name || 'Unknown',
                    email: emp.email || '',
                    avatar: emp.avatar || null,
                    date: rec.date,
                    shiftId: shift._id ? shift._id.toString() : (rec.shiftId?.toString() || null),
                    shiftName: rec.scheduled?.shiftName || shift.name || 'Assigned Shift',
                    scheduledStartTime: rec.scheduled?.startTime || null,
                    actualCheckIn: rec.actual?.firstCheckIn || null,
                    gracePeriodMinutes: rec.scheduled?.gracePeriodMinutes ?? 0,
                    lateMinutes: rec.metrics?.lateMinutes || 0,
                    status: rec.status,
                    punchStatus: rec.punchStatus || 'LATE',
                };
            });

            return {
                date: query.date || TimezoneUtils.formatDateInTimezone(new Date(), timezone),
                isRange: false,
                limit,
                total,
                ranking: items,
            };
        } else {
            // Multi-Day Ranking: Ranked primarily by total late minutes, secondarily by late days count
            const pipeline: PipelineStage[] = [
                { $match: dateMatch },
                {
                    $group: {
                        _id: '$employeeId',
                        totalLateMinutes: { $sum: '$metrics.lateMinutes' },
                        lateDaysCount: { $sum: 1 },
                        latestAttendanceId: { $last: '$_id' },
                        latestDate: { $max: '$date' },
                        shiftId: { $last: '$shiftId' },
                        scheduledStartTime: { $last: '$scheduled.startTime' },
                        actualCheckIn: { $last: '$actual.firstCheckIn' },
                        gracePeriodMinutes: { $last: '$scheduled.gracePeriodMinutes' },
                        status: { $last: '$status' },
                    },
                },
                { $sort: { totalLateMinutes: -1, lateDaysCount: -1, _id: 1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'shifts',
                        localField: 'shiftId',
                        foreignField: '_id',
                        as: 'shift',
                    },
                },
                { $unwind: { path: '$shift', preserveNullAndEmptyArrays: true } },
            ];

            const [results, totalCount] = await Promise.all([
                Attendance.aggregate(pipeline),
                Attendance.aggregate([
                    { $match: dateMatch },
                    { $group: { _id: '$employeeId' } },
                    { $count: 'total' },
                ]),
            ]);

            const total = totalCount[0]?.total || 0;

            const items = results.map((r, idx) => ({
                rank: skip + idx + 1,
                employeeId: r._id.toString(),
                employeeName: r.user?.name || 'Unknown',
                email: r.user?.email || '',
                avatar: r.user?.avatar || null,
                date: r.latestDate,
                shiftId: r.shiftId ? r.shiftId.toString() : null,
                shiftName: r.shift?.name || 'Assigned Shift',
                scheduledStartTime: r.scheduledStartTime,
                actualCheckIn: r.actualCheckIn,
                gracePeriodMinutes: r.gracePeriodMinutes || 0,
                lateMinutes: r.totalLateMinutes,
                lateDaysCount: r.lateDaysCount,
                status: r.status,
                attendanceId: r.latestAttendanceId ? r.latestAttendanceId.toString() : null,
            }));

            return {
                startDate: query.startDate,
                endDate: query.endDate,
                isRange: true,
                limit,
                total,
                ranking: items,
            };
        }
    }

    /**
     * GET /api/v1/company/attendance/:attendanceId
     * Returns full attendance details, shift, calculations, and adjustments.
     */
    static async getCompanyAttendanceRecordById(companyId: string, attendanceId: string) {
        if (!Types.ObjectId.isValid(attendanceId)) {
            throw AppError.badRequest('Invalid attendance ID format.');
        }

        const attendance = await Attendance.findOne({
            _id: new Types.ObjectId(attendanceId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('employeeId', 'name email avatar')
            .populate('shiftId', 'name code startTime endTime gracePeriodMinutes earlyCheckoutGracePeriodMinutes workingDays')
            .lean();

        if (!attendance) {
            throw AppError.notFound('Attendance record not found.');
        }

        const [events, adjustments] = await Promise.all([
            AttendanceEvent.find({
                attendanceId: attendance._id,
                companyId: new Types.ObjectId(companyId),
            })
                .sort({ timestamp: 1 })
                .lean(),
            AttendanceAdjustment.find({
                attendanceId: attendance._id,
                companyId: new Types.ObjectId(companyId),
            })
                .populate('requestedBy', 'name email')
                .populate('approvedBy', 'name email')
                .lean(),
        ]);

        return {
            attendance,
            events,
            adjustments,
        };
    }

    /**
     * GET /api/v1/company/attendance/records
     * Company Attendance Records with filters for date range, employee, status, late-only, incomplete-only.
     */
    static async getCompanyAttendanceRecords(
        companyId: string,
        query: CompanyAttendanceRecordsQueryDto
    ) {
        const companyObjId = new Types.ObjectId(companyId);
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = { companyId: companyObjId };

        if (query.date) {
            filter.date = query.date;
        } else if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        }

        if (query.employeeId && Types.ObjectId.isValid(query.employeeId)) {
            filter.employeeId = new Types.ObjectId(query.employeeId);
        }

        if (query.status) {
            filter.status = query.status;
        }

        if (query.lateOnly === true || query.lateOnly === 'true') {
            filter['metrics.lateMinutes'] = { $gt: 0 };
        }

        if (query.incompleteOnly === true || query.incompleteOnly === 'true') {
            filter['actual.firstCheckIn'] = { $ne: null };
            filter['actual.lastCheckOut'] = null;
        }

        const sortField = query.sortBy || 'date';
        const sortDir = query.sortOrder === 'asc' ? 1 : -1;
        const sort: Record<string, any> = { [sortField]: sortDir, createdAt: -1 };

        const [records, total] = await Promise.all([
            Attendance.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('employeeId', 'name email avatar')
                .populate('shiftId', 'name code startTime endTime')
                .lean(),
            Attendance.countDocuments(filter),
        ]);

        return {
            timezone,
            records: records.map((r: any) => ({
                id: r._id.toString(),
                date: r.date,
                employee: {
                    id: r.employeeId?._id ? r.employeeId._id.toString() : r.employeeId?.toString(),
                    name: r.employeeId?.name || 'Unknown',
                    email: r.employeeId?.email || '',
                    avatar: r.employeeId?.avatar || null,
                },
                status: r.status,
                shift: r.shiftId
                    ? {
                          id: r.shiftId._id?.toString(),
                          name: r.scheduled?.shiftName || r.shiftId.name,
                          code: r.scheduled?.shiftCode || r.shiftId.code,
                          startTime: r.shiftId.startTime,
                          endTime: r.shiftId.endTime,
                      }
                    : null,
                scheduled: r.scheduled,
                actual: {
                    firstCheckIn: r.actual?.firstCheckIn || null,
                    lastCheckOut: r.actual?.lastCheckOut || null,
                    workedMinutes: r.actual?.workedMinutes || 0,
                    workedHours: r.actual?.workedMinutes ? Math.round((r.actual.workedMinutes / 60) * 100) / 100 : 0,
                },
                metrics: r.metrics || { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                punchStatus: r.punchStatus || 'ON_TIME',
                checkoutStatus: r.checkoutStatus || 'ON_TIME',
                isFinalized: r.isFinalized ?? false,
                notes: r.notes || '',
            })),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    // ─── Phase 6: Member Attendance Methods ─────────────────────────────────────

    /**
     * GET /api/v1/member/attendance/today
     * Scoped strictly to authenticated member. Returns today's active shift, actual punches, and metrics.
     */
    static async getMemberTodayAttendance(companyId: string, employeeId: string) {
        const now = new Date();
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);

        const shiftResolution = await AttendanceCalculationService.resolveShiftSchedule(
            companyId,
            employeeId,
            now,
            timezone
        );

        const [attendance, holiday, leave] = await Promise.all([
            Attendance.findOne({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                date: shiftResolution.cycleDate,
            })
                .populate('shiftId', 'name code startTime endTime crossesMidnight workingDays timezone')
                .lean(),
            AttendanceCalculationService.resolveHoliday(companyId, shiftResolution.cycleDate),
            AttendanceCalculationService.resolveLeave(companyId, employeeId, shiftResolution.cycleDate),
        ]);

        const isWeekOff = AttendanceCalculationService.resolveWeekOff(
            shiftResolution.cycleDate,
            shiftResolution.shift
        );

        const isCheckedIn = !!(attendance?.actual?.firstCheckIn && !attendance?.actual?.lastCheckOut);
        const isCheckoutRequired = isCheckedIn;

        const workedMinutes = attendance?.actual?.workedMinutes || 0;
        const workedHours = Math.round((workedMinutes / 60) * 100) / 100;

        return {
            date: shiftResolution.cycleDate,
            timezone,
            isCheckedIn,
            isCheckoutRequired,
            shift: shiftResolution.shift
                ? {
                      id: shiftResolution.shift.shiftId,
                      name: shiftResolution.shift.name,
                      code: shiftResolution.shift.code,
                      startTime: shiftResolution.shift.startTime,
                      endTime: shiftResolution.shift.endTime,
                      gracePeriodMinutes: shiftResolution.gracePeriodMinutes,
                      earlyCheckoutGraceMinutes: shiftResolution.earlyCheckoutGraceMinutes,
                      workingDays: shiftResolution.shift.workingDays,
                  }
                : null,
            scheduled: {
                startTime: shiftResolution.scheduledStartTime,
                endTime: shiftResolution.scheduledEndTime,
                workingMinutes: shiftResolution.scheduledWorkingMinutes,
            },
            actual: {
                firstCheckIn: attendance?.actual?.firstCheckIn || null,
                lastCheckOut: attendance?.actual?.lastCheckOut || null,
                workedMinutes,
                workedHours,
            },
            metrics: attendance?.metrics || { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
            status: attendance?.status || (isWeekOff ? AttendanceStatus.WEEK_OFF : (holiday ? AttendanceStatus.HOLIDAY : AttendanceStatus.PENDING)),
            punchStatus: attendance?.punchStatus || 'ON_TIME',
            checkoutStatus: attendance?.checkoutStatus || 'ON_TIME',
            isOvernight: shiftResolution.isOvernight,
            holiday: holiday ? { id: holiday._id.toString(), name: holiday.name } : null,
            leave: leave ? { id: leave._id.toString(), type: leave.leaveType, durationType: leave.durationType } : null,
            isWeekOff,
            attendanceId: attendance?._id ? attendance._id.toString() : null,
        };
    }

    /**
     * GET /api/v1/member/attendance/history
     * Scoped strictly to authenticated member. Enforces bounded query limits.
     */
    static async getMemberAttendanceHistory(
        companyId: string,
        employeeId: string,
        query: MemberAttendanceHistoryQueryDto
    ) {
        const timezone = await TimezoneUtils.getCompanyTimezone(companyId);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(90, Math.max(1, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
        };

        if (query.startDate && query.endDate) {
            filter.date = { $gte: query.startDate, $lte: query.endDate };
        }

        if (query.status) {
            filter.status = query.status;
        }

        const [records, total] = await Promise.all([
            Attendance.find(filter)
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .populate('shiftId', 'name code startTime endTime')
                .lean(),
            Attendance.countDocuments(filter),
        ]);

        return {
            timezone,
            records: records.map((r: any) => ({
                id: r._id.toString(),
                date: r.date,
                status: r.status,
                shift: r.shiftId
                    ? {
                          id: r.shiftId._id?.toString(),
                          name: r.scheduled?.shiftName || r.shiftId.name,
                          code: r.scheduled?.shiftCode || r.shiftId.code,
                          startTime: r.shiftId.startTime,
                          endTime: r.shiftId.endTime,
                      }
                    : null,
                scheduled: r.scheduled,
                actual: {
                    firstCheckIn: r.actual?.firstCheckIn || null,
                    lastCheckOut: r.actual?.lastCheckOut || null,
                    workedMinutes: r.actual?.workedMinutes || 0,
                    workedHours: r.actual?.workedMinutes ? Math.round((r.actual.workedMinutes / 60) * 100) / 100 : 0,
                },
                metrics: r.metrics || { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
                punchStatus: r.punchStatus || 'ON_TIME',
                checkoutStatus: r.checkoutStatus || 'ON_TIME',
                isFinalized: r.isFinalized ?? false,
            })),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * GET /api/v1/member/attendance/:attendanceId
     * Member fetches details of an attendance day with cross-user ID tampering prevention.
     */
    static async getMemberAttendanceRecordById(
        companyId: string,
        employeeId: string,
        attendanceId: string
    ) {
        if (!Types.ObjectId.isValid(attendanceId)) {
            throw AppError.badRequest('Invalid attendance ID format.');
        }

        const attendance = await Attendance.findOne({
            _id: new Types.ObjectId(attendanceId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('shiftId', 'name code startTime endTime gracePeriodMinutes earlyCheckoutGracePeriodMinutes workingDays')
            .lean();

        if (!attendance) {
            throw AppError.notFound('Attendance record not found.');
        }

        // Strict cross-employee tampering guard: Must match authenticated member
        if (attendance.employeeId.toString() !== employeeId) {
            throw AppError.forbidden('You are not authorized to view another employee’s attendance record.');
        }

        const events = await AttendanceEvent.find({
            attendanceId: attendance._id,
            companyId: new Types.ObjectId(companyId),
        })
            .sort({ timestamp: 1 })
            .lean();

        return {
            attendance,
            events,
        };
    }
}
