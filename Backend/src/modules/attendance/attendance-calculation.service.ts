import { Types } from 'mongoose';
import { EmployeeShiftAssignmentService } from '../shifts/employee-shift-assignment.service';
import { ResolvedEmployeeShift } from '../shifts/shift.types';
import { Holiday } from './holiday.model';
import { LeaveRequest } from './leave.model';
import {
    AttendanceStatus,
    IHolidayDocument,
    ILeaveRequestDocument,
    LeaveStatus,
    PunchStatus,
    CheckoutStatus,
} from './attendance.types';
import { TimezoneUtils } from './utils/timezone.utils';

export interface ShiftScheduleResolution {
    shift: ResolvedEmployeeShift | null;
    shiftId: Types.ObjectId | null;
    shiftName: string | null;
    shiftCode: string | null;
    cycleDate: string; // "YYYY-MM-DD"
    scheduledStartTime: Date | null;
    scheduledEndTime: Date | null;
    scheduledWorkingMinutes: number;
    gracePeriodMinutes: number;
    earlyCheckoutGraceMinutes: number;
    isOvernight: boolean;
    isAssigned: boolean;
}

export interface AttendanceStatusEvaluationInput {
    hasCheckIn: boolean;
    hasCheckOut: boolean;
    workedMinutes: number;
    scheduledWorkingMinutes: number;
    halfDayThresholdMinutes: number;
    leave: ILeaveRequestDocument | null;
    holiday: IHolidayDocument | null;
    isWeekOff: boolean;
    isShiftConcluded?: boolean;
    hasAssignedShift?: boolean;
}

export interface WorkInterval {
    start: Date;
    end: Date | null;
    isBreak?: boolean;
}

export class AttendanceCalculationService {
    /**
     * Resolves shift schedule & cycle date boundaries for an employee punch or calculation.
     * Accurately supports daytime and overnight shifts (e.g. 22:00 -> 06:00).
     * If no shift is assigned or configured, returns an explicit isAssigned: false state.
     */
    static async resolveShiftSchedule(
        companyId: string,
        employeeId: string,
        punchTime: Date = new Date(),
        timezone = 'Asia/Kolkata'
    ): Promise<ShiftScheduleResolution> {
        const timeParts = TimezoneUtils.getTimeComponentsInTimezone(punchTime, timezone);
        const resolvedShift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
            companyId,
            employeeId,
            punchTime
        );

        if (!resolvedShift) {
            return {
                shift: null,
                shiftId: null,
                shiftName: null,
                shiftCode: null,
                cycleDate: timeParts.dateString,
                scheduledStartTime: null,
                scheduledEndTime: null,
                scheduledWorkingMinutes: 0,
                gracePeriodMinutes: 0,
                earlyCheckoutGraceMinutes: 0,
                isOvernight: false,
                isAssigned: false,
            };
        }

        const startTimeStr = resolvedShift.startTime || '09:00';
        const endTimeStr = resolvedShift.endTime || '17:30';
        const crossesMidnight = resolvedShift.crossesMidnight ?? false;
        const gracePeriodMinutes = resolvedShift.gracePeriodMinutes ?? 0;
        const earlyCheckoutGraceMinutes = resolvedShift.earlyCheckoutGracePeriodMinutes ?? 0;
        const shiftId = resolvedShift.shiftId ? new Types.ObjectId(resolvedShift.shiftId) : null;
        const shiftName = resolvedShift.name || null;
        const shiftCode = resolvedShift.code || null;
        const isAssigned = resolvedShift.isAssigned ?? true;

        let cycleDate = timeParts.dateString;
        let scheduledStartTime: Date;
        let scheduledEndTime: Date;

        if (crossesMidnight) {
            const [sH] = startTimeStr.split(':').map(Number);
            const currentHour = timeParts.hour;

            // If current time is in the early morning part of an overnight shift (e.g., 00:00 to before start - 4h)
            if (currentHour < sH - 4) {
                // Belongs to yesterday's shift cycle
                const yesterdayStr = TimezoneUtils.addDaysToDateString(timeParts.dateString, -1);
                cycleDate = yesterdayStr;
                scheduledStartTime = TimezoneUtils.constructDateTimeInTimezone(
                    yesterdayStr,
                    startTimeStr,
                    timezone
                );
                scheduledEndTime = TimezoneUtils.constructDateTimeInTimezone(
                    timeParts.dateString,
                    endTimeStr,
                    timezone
                );
            } else {
                // Starts today and ends tomorrow morning
                const tomorrowStr = TimezoneUtils.addDaysToDateString(timeParts.dateString, 1);
                cycleDate = timeParts.dateString;
                scheduledStartTime = TimezoneUtils.constructDateTimeInTimezone(
                    timeParts.dateString,
                    startTimeStr,
                    timezone
                );
                scheduledEndTime = TimezoneUtils.constructDateTimeInTimezone(
                    tomorrowStr,
                    endTimeStr,
                    timezone
                );
            }
        } else {
            // Standard daytime shift
            cycleDate = timeParts.dateString;
            scheduledStartTime = TimezoneUtils.constructDateTimeInTimezone(
                timeParts.dateString,
                startTimeStr,
                timezone
            );
            scheduledEndTime = TimezoneUtils.constructDateTimeInTimezone(
                timeParts.dateString,
                endTimeStr,
                timezone
            );
        }

        const scheduledWorkingMinutes = Math.max(
            0,
            Math.round((scheduledEndTime.getTime() - scheduledStartTime.getTime()) / (60 * 1000))
        );

        return {
            shift: resolvedShift,
            shiftId,
            shiftName,
            shiftCode,
            cycleDate,
            scheduledStartTime,
            scheduledEndTime,
            scheduledWorkingMinutes,
            gracePeriodMinutes,
            earlyCheckoutGraceMinutes,
            isOvernight: crossesMidnight,
            isAssigned,
        };
    }

    /**
     * Resolves whether a date is a Company Holiday.
     */
    static async resolveHoliday(
        companyId: string,
        dateStr: string
    ): Promise<IHolidayDocument | null> {
        const companyObjId = new Types.ObjectId(companyId);

        // Exact date match
        const exactHoliday = await Holiday.findOne({
            companyId: companyObjId,
            date: dateStr,
        }).lean();

        if (exactHoliday) return exactHoliday as IHolidayDocument;

        // Recurring holiday match (same MM-DD)
        const monthDay = dateStr.slice(5); // "MM-DD"
        const recurringHoliday = await Holiday.findOne({
            companyId: companyObjId,
            isRecurring: true,
            date: { $regex: new RegExp(`-${monthDay}$`) },
        }).lean();

        return recurringHoliday as IHolidayDocument | null;
    }

    /**
     * Resolves whether an employee has an Approved Leave covering dateStr.
     */
    static async resolveLeave(
        companyId: string,
        employeeId: string,
        dateStr: string
    ): Promise<ILeaveRequestDocument | null> {
        const leave = await LeaveRequest.findOne({
            companyId: new Types.ObjectId(companyId),
            employeeId: new Types.ObjectId(employeeId),
            status: LeaveStatus.APPROVED,
            startDate: { $lte: dateStr },
            endDate: { $gte: dateStr },
        }).lean();

        return leave as ILeaveRequestDocument | null;
    }

    /**
     * Resolves whether a given date is a Week-Off day based on shift working days.
     */
    static resolveWeekOff(dateStr: string, shift: ResolvedEmployeeShift | null): boolean {
        const workingDays = shift?.workingDays || [1, 2, 3, 4, 5]; // Default Mon-Fri
        const dayOfWeek = TimezoneUtils.getDayOfWeekFromDateString(dateStr);
        return !workingDays.includes(dayOfWeek);
    }

    /**
     * Calculates late arrival minutes against scheduled start time and grace minutes.
     * Defined rule: lateMinutes = max(0, actualCheckIn - (scheduledShiftStart + gracePeriod))
     * Applied only when the employee has an applicable shift and valid check-in.
     * Grace period of 0 is fully supported.
     */
    static calculateLateMinutes(
        checkInTime: Date | null,
        scheduledStartTime: Date | null,
        graceMinutes: number = 0
    ): {
        lateMinutes: number;
        minutesPastScheduledStart: number;
        punchStatus: PunchStatus;
        gracePeriodMinutes: number;
    } {
        if (!checkInTime || !scheduledStartTime) {
            return {
                lateMinutes: 0,
                minutesPastScheduledStart: 0,
                punchStatus: 'ON_TIME',
                gracePeriodMinutes: graceMinutes || 0,
            };
        }

        const checkInMs = checkInTime.getTime();
        const startMs = scheduledStartTime.getTime();
        const gracePeriod = Math.max(0, graceMinutes || 0);
        const graceMs = gracePeriod * 60 * 1000;
        const graceThresholdMs = startMs + graceMs;

        const minutesPastScheduledStart = Math.max(
            0,
            Math.round((checkInMs - startMs) / (60 * 1000))
        );

        if (checkInMs > graceThresholdMs) {
            const lateMinutes = Math.max(
                0,
                Math.round((checkInMs - graceThresholdMs) / (60 * 1000))
            );
            return {
                lateMinutes,
                minutesPastScheduledStart,
                punchStatus: 'LATE',
                gracePeriodMinutes: gracePeriod,
            };
        }

        return {
            lateMinutes: 0,
            minutesPastScheduledStart,
            punchStatus: 'ON_TIME',
            gracePeriodMinutes: gracePeriod,
        };
    }

    /**
     * Calculates early departure and overtime minutes on check-out.
     * Defined rule: earlyDepartureMinutes = max(0, scheduledShiftEnd - actualCheckOut)
     * Calculated only when there is a valid completed checkout and scheduled shift end.
     * If checked out after scheduled end, earlyDepartureMinutes is 0.
     */
    static calculateEarlyLeaveAndOvertime(
        checkOutTime: Date | null,
        scheduledEndTime: Date | null,
        earlyCheckoutGraceMinutes: number = 0
    ): {
        earlyLeaveMinutes: number;
        overtimeMinutes: number;
        checkoutStatus: CheckoutStatus;
        earlyCheckoutGraceMinutes: number;
    } {
        if (!checkOutTime || !scheduledEndTime) {
            return {
                earlyLeaveMinutes: 0,
                overtimeMinutes: 0,
                checkoutStatus: 'ON_TIME',
                earlyCheckoutGraceMinutes: earlyCheckoutGraceMinutes || 0,
            };
        }

        const checkOutMs = checkOutTime.getTime();
        const endMs = scheduledEndTime.getTime();
        const earlyGrace = Math.max(0, earlyCheckoutGraceMinutes || 0);
        const earlyThresholdMs = endMs - earlyGrace * 60 * 1000;

        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;
        let checkoutStatus: CheckoutStatus = 'ON_TIME';

        if (checkOutMs < earlyThresholdMs) {
            checkoutStatus = 'EARLY_OUT';
            earlyLeaveMinutes = Math.max(
                0,
                Math.round((endMs - checkOutMs) / (60 * 1000))
            );
        } else if (checkOutMs > endMs) {
            checkoutStatus = 'OVERTIME';
            overtimeMinutes = Math.max(
                0,
                Math.round((checkOutMs - endMs) / (60 * 1000))
            );
        }

        return {
            earlyLeaveMinutes,
            overtimeMinutes,
            checkoutStatus,
            earlyCheckoutGraceMinutes: earlyGrace,
        };
    }

    /**
     * Calculates net worked minutes between firstCheckIn and lastCheckOut minus break duration.
     * Rejects reversed or invalid timestamps.
     */
    static calculateWorkedMinutes(
        firstCheckIn: Date | null,
        lastCheckOut: Date | null,
        breakMinutes: number = 0
    ): number {
        if (!firstCheckIn || !lastCheckOut) return 0;
        const diffMs = lastCheckOut.getTime() - firstCheckIn.getTime();
        if (diffMs < 0) return 0; // Reversed timestamps rejected

        const diffMinutes = Math.round(diffMs / (60 * 1000));
        return Math.max(0, diffMinutes - (breakMinutes || 0));
    }

    /**
     * Non-overlapping interval accumulator to calculate net working time without double-counting.
     */
    static calculateIntervalsWorkedMinutes(
        intervals: WorkInterval[]
    ): { elapsedMinutes: number; breakMinutes: number; netWorkedMinutes: number } {
        if (!intervals || intervals.length === 0) {
            return { elapsedMinutes: 0, breakMinutes: 0, netWorkedMinutes: 0 };
        }

        const validIntervals = intervals
            .filter((i) => i.start && i.end && i.end.getTime() >= i.start.getTime())
            .sort((a, b) => a.start.getTime() - b.start.getTime());

        if (validIntervals.length === 0) {
            return { elapsedMinutes: 0, breakMinutes: 0, netWorkedMinutes: 0 };
        }

        const minStart = validIntervals[0].start.getTime();
        const maxEnd = Math.max(...validIntervals.map((i) => i.end!.getTime()));
        const elapsedMinutes = Math.round((maxEnd - minStart) / (60 * 1000));

        let breakMinutes = 0;
        const workSegments: Array<{ start: number; end: number }> = [];

        for (const item of validIntervals) {
            const s = item.start.getTime();
            const e = item.end!.getTime();
            if (item.isBreak) {
                breakMinutes += Math.round((e - s) / (60 * 1000));
            } else {
                workSegments.push({ start: s, end: e });
            }
        }

        // Merge overlapping work segments
        let mergedWorkMs = 0;
        if (workSegments.length > 0) {
            let currentStart = workSegments[0].start;
            let currentEnd = workSegments[0].end;

            for (let i = 1; i < workSegments.length; i++) {
                const seg = workSegments[i];
                if (seg.start <= currentEnd) {
                    currentEnd = Math.max(currentEnd, seg.end);
                } else {
                    mergedWorkMs += currentEnd - currentStart;
                    currentStart = seg.start;
                    currentEnd = seg.end;
                }
            }
            mergedWorkMs += currentEnd - currentStart;
        }

        const netWorkedMinutes = Math.max(0, Math.round(mergedWorkMs / (60 * 1000)));

        return {
            elapsedMinutes,
            breakMinutes,
            netWorkedMinutes,
        };
    }

    /**
     * Pure calculation engine to derive the canonical AttendanceStatus based on all business criteria.
     * Precedence: Holiday -> Approved Leave -> Week Off -> Present / Half Day -> Absent / Pending.
     * If employee has no assigned shift, absence is NOT assigned before confirmation.
     */
    static calculateAttendanceStatus(input: AttendanceStatusEvaluationInput): AttendanceStatus {
        const {
            hasCheckIn,
            workedMinutes,
            halfDayThresholdMinutes,
            leave,
            holiday,
            isWeekOff,
            isShiftConcluded,
            hasAssignedShift = true,
        } = input;

        // 1. Company Holiday precedence
        if (holiday) {
            return AttendanceStatus.HOLIDAY;
        }

        // 2. Approved Full-day Leave precedence
        if (leave && leave.durationType !== 'HALF_DAY') {
            return AttendanceStatus.LEAVE;
        }

        // 3. Approved Half-day Leave precedence
        if (leave && leave.durationType === 'HALF_DAY') {
            return AttendanceStatus.HALF_DAY;
        }

        // 4. Week-Off precedence (if employee did not punch in)
        if (isWeekOff && !hasCheckIn) {
            return AttendanceStatus.WEEK_OFF;
        }

        // 5. Check-in event exists
        if (hasCheckIn) {
            if (workedMinutes > 0 && workedMinutes < halfDayThresholdMinutes && isShiftConcluded) {
                return AttendanceStatus.HALF_DAY;
            }
            return AttendanceStatus.PRESENT;
        }

        // 6. No check-in event
        if (isShiftConcluded) {
            // Only mark absent if the employee has a designated working shift on this day
            if (hasAssignedShift) {
                return AttendanceStatus.ABSENT;
            }
            return AttendanceStatus.PENDING;
        }

        return AttendanceStatus.PENDING;
    }
}
