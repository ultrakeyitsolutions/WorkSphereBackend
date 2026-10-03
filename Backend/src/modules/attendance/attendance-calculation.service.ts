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
    cycleDate: string; // "YYYY-MM-DD"
    scheduledStartTime: Date;
    scheduledEndTime: Date;
    scheduledWorkingMinutes: number;
    gracePeriodMinutes: number;
    earlyCheckoutGraceMinutes: number;
    isOvernight: boolean;
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
}

export class AttendanceCalculationService {
    /**
     * Resolves shift schedule & cycle date boundaries for an employee punch or calculation.
     * Accurately supports overnight shifts (e.g. 22:00 -> 06:00).
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

        const startTimeStr = resolvedShift?.startTime || '09:00';
        const endTimeStr = resolvedShift?.endTime || '17:30';
        const crossesMidnight = resolvedShift?.crossesMidnight ?? false;
        const gracePeriodMinutes = resolvedShift?.gracePeriodMinutes ?? 10;
        const earlyCheckoutGraceMinutes = resolvedShift?.earlyCheckoutGracePeriodMinutes ?? 5;
        const shiftId = resolvedShift?.shiftId ? new Types.ObjectId(resolvedShift.shiftId) : null;

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
            60,
            Math.round((scheduledEndTime.getTime() - scheduledStartTime.getTime()) / (60 * 1000))
        );

        return {
            shift: resolvedShift,
            shiftId,
            cycleDate,
            scheduledStartTime,
            scheduledEndTime,
            scheduledWorkingMinutes,
            gracePeriodMinutes,
            earlyCheckoutGraceMinutes,
            isOvernight: crossesMidnight,
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
     */
    static calculateLateMinutes(
        checkInTime: Date,
        scheduledStartTime: Date,
        graceMinutes = 10
    ): { lateMinutes: number; punchStatus: PunchStatus } {
        const graceThresholdMs = scheduledStartTime.getTime() + graceMinutes * 60 * 1000;
        if (checkInTime.getTime() > graceThresholdMs) {
            const lateMinutes = Math.max(
                0,
                Math.round((checkInTime.getTime() - scheduledStartTime.getTime()) / (60 * 1000))
            );
            return {
                lateMinutes,
                punchStatus: 'LATE',
            };
        }
        return {
            lateMinutes: 0,
            punchStatus: 'ON_TIME',
        };
    }

    /**
     * Calculates early departure and overtime minutes on check-out.
     */
    static calculateEarlyLeaveAndOvertime(
        checkOutTime: Date,
        scheduledEndTime: Date,
        earlyCheckoutGraceMinutes = 5
    ): { earlyLeaveMinutes: number; overtimeMinutes: number; checkoutStatus: CheckoutStatus } {
        const earlyThresholdMs = scheduledEndTime.getTime() - earlyCheckoutGraceMinutes * 60 * 1000;
        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;
        let checkoutStatus: CheckoutStatus = 'ON_TIME';

        if (checkOutTime.getTime() < earlyThresholdMs) {
            checkoutStatus = 'EARLY_OUT';
            earlyLeaveMinutes = Math.max(
                0,
                Math.round((scheduledEndTime.getTime() - checkOutTime.getTime()) / (60 * 1000))
            );
        } else if (checkOutTime.getTime() > scheduledEndTime.getTime()) {
            checkoutStatus = 'OVERTIME';
            overtimeMinutes = Math.max(
                0,
                Math.round((checkOutTime.getTime() - scheduledEndTime.getTime()) / (60 * 1000))
            );
        }

        return {
            earlyLeaveMinutes,
            overtimeMinutes,
            checkoutStatus,
        };
    }

    /**
     * Calculates net worked minutes between firstCheckIn and lastCheckOut.
     */
    static calculateWorkedMinutes(
        firstCheckIn: Date | null,
        lastCheckOut: Date | null,
        breakMinutes = 0
    ): number {
        if (!firstCheckIn || !lastCheckOut) return 0;
        const diffMinutes = Math.round(
            (lastCheckOut.getTime() - firstCheckIn.getTime()) / (60 * 1000)
        );
        return Math.max(0, diffMinutes - (breakMinutes || 0));
    }

    /**
     * Pure calculation engine to derive the canonical AttendanceStatus based on all business criteria.
     * Core Principle: Approved leave/holiday/week-off ALWAYS take precedence over absence.
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
            if (hasCheckIn) {
                return AttendanceStatus.HALF_DAY;
            }
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
            return AttendanceStatus.ABSENT;
        }

        return AttendanceStatus.PENDING;
    }
}
