import { Types } from 'mongoose';
import { EmployeeShiftAssignmentService } from './employee-shift-assignment.service';
import {
    ResolvedEmployeeShift,
    CheckInEvaluationResult,
    CheckOutEvaluationResult,
} from './shift.types';

export class AttendanceEvaluationService {
    /**
     * Parse time string "HH:mm" on a given base date in local/UTC.
     */
    private static constructDateTime(baseDate: Date, timeStr: string): Date {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const dt = new Date(baseDate);
        dt.setHours(hours, minutes, 0, 0);
        return dt;
    }

    /**
     * Formats a date into "YYYY-MM-DD" string.
     */
    public static formatDateString(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Evaluates a Check-In timestamp against the employee's resolved shift schedule.
     */
    static async evaluateCheckIn(
        companyId: string,
        userId: string,
        checkInTime: Date = new Date()
    ): Promise<CheckInEvaluationResult> {
        // 1. Resolve applicable shift on this date
        const shift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
            companyId,
            userId,
            checkInTime
        );

        // Fallback default if no shift is registered in the company
        const startTimeStr = shift?.startTime || '09:00';
        const endTimeStr = shift?.endTime || '17:30';
        const crossesMidnight = shift?.crossesMidnight ?? false;
        const gracePeriod = shift?.gracePeriodMinutes ?? 10;
        const shiftId = shift ? new Types.ObjectId(shift.shiftId) : new Types.ObjectId();

        let scheduledStartTime: Date;
        let scheduledEndTime: Date;
        let attendanceDate: string;

        if (crossesMidnight) {
            // Check if check-in occurred after midnight (e.g. 00:00 - 11:59 for a night shift)
            const [sH] = startTimeStr.split(':').map(Number);
            const currentHour = checkInTime.getHours();

            if (currentHour < sH - 4) {
                // Belonged to yesterday's night shift cycle
                const yesterday = new Date(checkInTime);
                yesterday.setDate(yesterday.getDate() - 1);
                scheduledStartTime = this.constructDateTime(yesterday, startTimeStr);
                scheduledEndTime = this.constructDateTime(checkInTime, endTimeStr);
                attendanceDate = this.formatDateString(yesterday);
            } else {
                // Standard night shift starting today
                const tomorrow = new Date(checkInTime);
                tomorrow.setDate(tomorrow.getDate() + 1);
                scheduledStartTime = this.constructDateTime(checkInTime, startTimeStr);
                scheduledEndTime = this.constructDateTime(tomorrow, endTimeStr);
                attendanceDate = this.formatDateString(checkInTime);
            }
        } else {
            // Standard day shift
            scheduledStartTime = this.constructDateTime(checkInTime, startTimeStr);
            scheduledEndTime = this.constructDateTime(checkInTime, endTimeStr);
            attendanceDate = this.formatDateString(checkInTime);
        }

        // 2. Late and Grace Period Calculation
        const graceThresholdMs = scheduledStartTime.getTime() + gracePeriod * 60 * 1000;
        let punchStatus: 'ON_TIME' | 'LATE' = 'ON_TIME';
        let lateMinutes = 0;

        if (checkInTime.getTime() > graceThresholdMs) {
            punchStatus = 'LATE';
            lateMinutes = Math.max(
                0,
                Math.round((checkInTime.getTime() - scheduledStartTime.getTime()) / (60 * 1000))
            );
        }

        return {
            punchStatus,
            lateMinutes,
            scheduledStartTime,
            scheduledEndTime,
            attendanceDate,
            isOvernight: crossesMidnight,
            shiftId,
        };
    }

    /**
     * Evaluates a Check-Out timestamp against an attendance session and shift schedule.
     */
    static evaluateCheckOut(
        checkInTime: Date,
        checkOutTime: Date,
        scheduledEndTime: Date,
        earlyCheckoutGraceMinutes = 5
    ): CheckOutEvaluationResult {
        const workDurationMinutes = Math.max(
            0,
            Math.round((checkOutTime.getTime() - checkInTime.getTime()) / (60 * 1000))
        );

        const earlyThresholdMs = scheduledEndTime.getTime() - earlyCheckoutGraceMinutes * 60 * 1000;
        let checkoutStatus: 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME' = 'ON_TIME';
        let earlyDepartureMinutes = 0;
        let overtimeMinutes = 0;

        if (checkOutTime.getTime() < earlyThresholdMs) {
            checkoutStatus = 'EARLY_OUT';
            earlyDepartureMinutes = Math.max(
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
            checkoutStatus,
            earlyDepartureMinutes,
            overtimeMinutes,
            workDurationMinutes,
            scheduledEndTime,
        };
    }
}
