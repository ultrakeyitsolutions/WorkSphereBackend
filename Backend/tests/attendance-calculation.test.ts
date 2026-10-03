import { describe, it, expect, vi } from 'vitest';
import { AttendanceCalculationService } from '../src/modules/attendance/attendance-calculation.service';
import { TimezoneUtils } from '../src/modules/attendance/utils/timezone.utils';
import { AttendanceStatus } from '../src/modules/attendance/attendance.types';

describe('Attendance Calculation Service - Unit Tests', () => {
    describe('Timezone & Date Utilities', () => {
        it('should correctly format date in timezone', () => {
            const date = new Date('2026-10-03T18:30:00.000Z'); // 00:00 AM on Oct 4 in IST (UTC+5:30)
            const dateStr = TimezoneUtils.formatDateInTimezone(date, 'Asia/Kolkata');
            expect(dateStr).toBe('2026-10-04');
        });

        it('should extract correct day of week for Monday through Sunday', () => {
            // 2026-10-05 is Monday (1), 2026-10-11 is Sunday (7)
            expect(TimezoneUtils.getDayOfWeekFromDateString('2026-10-05')).toBe(1);
            expect(TimezoneUtils.getDayOfWeekFromDateString('2026-10-11')).toBe(7);
        });

        it('should generate contiguous date range array', () => {
            const dates = TimezoneUtils.getDateRangeArray('2026-10-01', '2026-10-05');
            expect(dates).toEqual([
                '2026-10-01',
                '2026-10-02',
                '2026-10-03',
                '2026-10-04',
                '2026-10-05',
            ]);
        });
    });

    describe('Lateness Calculation with Grace Period', () => {
        const scheduledStart = new Date('2026-10-03T09:00:00.000Z');

        it('should mark ON_TIME when punching within grace period', () => {
            const punchTime = new Date('2026-10-03T09:08:00.000Z'); // 8 mins late, grace is 10
            const result = AttendanceCalculationService.calculateLateMinutes(punchTime, scheduledStart, 10);
            expect(result.punchStatus).toBe('ON_TIME');
            expect(result.lateMinutes).toBe(0);
        });

        it('should mark LATE and calculate exact minutes when exceeding grace period', () => {
            const punchTime = new Date('2026-10-03T09:25:00.000Z'); // 25 mins late
            const result = AttendanceCalculationService.calculateLateMinutes(punchTime, scheduledStart, 10);
            expect(result.punchStatus).toBe('LATE');
            expect(result.lateMinutes).toBe(25);
        });
    });

    describe('Early Departure & Overtime Calculation', () => {
        const scheduledEnd = new Date('2026-10-03T18:00:00.000Z');

        it('should detect EARLY_OUT when leaving before grace period threshold', () => {
            const checkOutTime = new Date('2026-10-03T17:30:00.000Z'); // 30 mins early
            const result = AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                checkOutTime,
                scheduledEnd,
                5
            );
            expect(result.checkoutStatus).toBe('EARLY_OUT');
            expect(result.earlyLeaveMinutes).toBe(30);
            expect(result.overtimeMinutes).toBe(0);
        });

        it('should detect ON_TIME when leaving within early departure grace window', () => {
            const checkOutTime = new Date('2026-10-03T17:58:00.000Z'); // 2 mins early, grace is 5
            const result = AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                checkOutTime,
                scheduledEnd,
                5
            );
            expect(result.checkoutStatus).toBe('ON_TIME');
            expect(result.earlyLeaveMinutes).toBe(0);
        });

        it('should detect OVERTIME when working past scheduled shift end', () => {
            const checkOutTime = new Date('2026-10-03T19:15:00.000Z'); // 75 mins overtime
            const result = AttendanceCalculationService.calculateEarlyLeaveAndOvertime(
                checkOutTime,
                scheduledEnd,
                5
            );
            expect(result.checkoutStatus).toBe('OVERTIME');
            expect(result.overtimeMinutes).toBe(75);
            expect(result.earlyLeaveMinutes).toBe(0);
        });
    });

    describe('Net Worked Minutes Calculation', () => {
        it('should calculate accurate worked minutes minus break', () => {
            const checkIn = new Date('2026-10-03T09:00:00.000Z');
            const checkOut = new Date('2026-10-03T18:00:00.000Z'); // 9 hours = 540 mins
            const worked = AttendanceCalculationService.calculateWorkedMinutes(checkIn, checkOut, 60); // 60 mins break
            expect(worked).toBe(480);
        });
    });

    describe('Week-Off Resolution', () => {
        const shift: any = {
            workingDays: [1, 2, 3, 4, 5], // Monday to Friday
        };

        it('should return false for working day (e.g. Wednesday)', () => {
            const isWeekOff = AttendanceCalculationService.resolveWeekOff('2026-10-07', shift); // Wed
            expect(isWeekOff).toBe(false);
        });

        it('should return true for weekend (e.g. Saturday & Sunday)', () => {
            const satOff = AttendanceCalculationService.resolveWeekOff('2026-10-10', shift); // Sat
            const sunOff = AttendanceCalculationService.resolveWeekOff('2026-10-11', shift); // Sun
            expect(satOff).toBe(true);
            expect(sunOff).toBe(true);
        });
    });

    describe('Attendance Status Precedence & Evaluation Rules', () => {
        it('Rule 1: Holiday takes absolute precedence over absence or pending', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: false,
                hasCheckOut: false,
                workedMinutes: 0,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: null,
                holiday: { _id: 'h1', name: 'Gandhi Jayanti' } as any,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.HOLIDAY);
        });

        it('Rule 2: Approved Full-day Leave takes precedence over absence', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: false,
                hasCheckOut: false,
                workedMinutes: 0,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: { _id: 'l1', durationType: 'FULL_DAY', leaveType: 'CASUAL' } as any,
                holiday: null,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.LEAVE);
        });

        it('Rule 3: Approved Half-day Leave resolves to HALF_DAY', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: true,
                hasCheckOut: true,
                workedMinutes: 240,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: { _id: 'l2', durationType: 'HALF_DAY', leaveType: 'SICK' } as any,
                holiday: null,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.HALF_DAY);
        });

        it('Rule 4: Week-off with no check-in resolves to WEEK_OFF, not ABSENT', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: false,
                hasCheckOut: false,
                workedMinutes: 0,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: null,
                holiday: null,
                isWeekOff: true,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.WEEK_OFF);
        });

        it('Rule 5: Standard completed shift with full hours resolves to PRESENT', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: true,
                hasCheckOut: true,
                workedMinutes: 480,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: null,
                holiday: null,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.PRESENT);
        });

        it('Rule 6: Low working hours below threshold on concluded shift resolves to HALF_DAY', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: true,
                hasCheckOut: true,
                workedMinutes: 180, // Less than 240 mins
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: null,
                holiday: null,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.HALF_DAY);
        });

        it('Rule 7: Finalized shift with no punch, no holiday, no leave, no week-off resolves to ABSENT', () => {
            const status = AttendanceCalculationService.calculateAttendanceStatus({
                hasCheckIn: false,
                hasCheckOut: false,
                workedMinutes: 0,
                scheduledWorkingMinutes: 480,
                halfDayThresholdMinutes: 240,
                leave: null,
                holiday: null,
                isWeekOff: false,
                isShiftConcluded: true,
            });
            expect(status).toBe(AttendanceStatus.ABSENT);
        });
    });
});
