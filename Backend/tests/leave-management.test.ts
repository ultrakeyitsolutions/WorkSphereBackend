import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { LeaveCalculatorService } from '../src/modules/companyadmin/leave/leave-calculator.service';
import { LeaveType, LeaveDurationType } from '../src/modules/attendance/attendance.types';
import { Holiday } from '../src/modules/attendance/holiday.model';
import { EmployeeMonthlyLeaveBalance } from '../src/modules/companyadmin/leave/leave-balance.model';

describe('Leave Management & Loss of Pay (LOP) - Comprehensive Unit Tests', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockEmployeeId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock Holiday query
        vi.spyOn(Holiday, 'find').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            }),
        } as any);

        // Mock EmployeeMonthlyLeaveBalance findOne
        vi.spyOn(EmployeeMonthlyLeaveBalance, 'findOne').mockResolvedValue(null as any);
    });

    describe('1. Monetary Rounding & Safe Arithmetic Rules', () => {
        it('should correctly round HALF_UP by default', () => {
            expect(LeaveCalculatorService.roundAmount(1234.567, 'ROUND_HALF_UP')).toBe(1235);
            expect(LeaveCalculatorService.roundAmount(1234.4, 'ROUND_HALF_UP')).toBe(1234);
            expect(LeaveCalculatorService.roundAmount(1234.5, 'ROUND_HALF_UP')).toBe(1235);
        });

        it('should correctly round UP (ceiling)', () => {
            expect(LeaveCalculatorService.roundAmount(100.01, 'ROUND_UP')).toBe(101);
            expect(LeaveCalculatorService.roundAmount(100.00, 'ROUND_UP')).toBe(100);
        });

        it('should correctly round DOWN (floor)', () => {
            expect(LeaveCalculatorService.roundAmount(100.99, 'ROUND_DOWN')).toBe(100);
            expect(LeaveCalculatorService.roundAmount(100.00, 'ROUND_DOWN')).toBe(100);
        });

        it('should preserve 2 decimal places when rule is NONE', () => {
            expect(LeaveCalculatorService.roundAmount(1234.567, 'NONE')).toBe(1234.57);
            expect(LeaveCalculatorService.roundAmount(1234.562, 'NONE')).toBe(1234.56);
        });

        it('should return 0 for negative, invalid or non-finite amounts', () => {
            expect(LeaveCalculatorService.roundAmount(-500)).toBe(0);
            expect(LeaveCalculatorService.roundAmount(NaN)).toBe(0);
            expect(LeaveCalculatorService.roundAmount(Infinity)).toBe(0);
        });
    });

    describe('2. Timezone & Multi-Month Working Day Calculations', () => {
        it('should split contiguous date ranges spanning across months into separate buckets', async () => {
            // Oct 29, 2026 to Nov 3, 2026
            const startDate = '2026-10-29';
            const endDate = '2026-11-03';

            const result = await LeaveCalculatorService.calculateWorkingDays(
                mockCompanyId,
                mockEmployeeId,
                startDate,
                endDate,
                LeaveDurationType.FULL_DAY,
                { countWeekends: true, countHolidays: true }
            );

            expect(result.totalDays).toBe(6);
            expect(Object.keys(result.monthMap)).toEqual(['2026-10', '2026-11']);
            expect(result.monthMap['2026-10']).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
            expect(result.monthMap['2026-11']).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
        });

        it('should exclude weekends when countWeekends is false', async () => {
            // 2026-10-09 (Fri) to 2026-10-12 (Mon) -> 4 calendar days, 2 weekend days (Sat 10, Sun 11)
            const startDate = '2026-10-09';
            const endDate = '2026-10-12';

            const result = await LeaveCalculatorService.calculateWorkingDays(
                mockCompanyId,
                mockEmployeeId,
                startDate,
                endDate,
                LeaveDurationType.FULL_DAY,
                { countWeekends: false, countHolidays: true }
            );

            expect(result.totalDays).toBe(2); // Friday and Monday
            expect(result.monthMap['2026-10']).toEqual(['2026-10-09', '2026-10-12']);
        });

        it('should support half-day leave calculations (0.5 day weight)', async () => {
            const startDate = '2026-10-05';
            const endDate = '2026-10-05';

            const result = await LeaveCalculatorService.calculateWorkingDays(
                mockCompanyId,
                mockEmployeeId,
                startDate,
                endDate,
                LeaveDurationType.HALF_DAY,
                { countWeekends: false, countHolidays: false }
            );

            expect(result.totalDays).toBe(0.5);
            expect(result.monthMap['2026-10']).toEqual(['2026-10-05']);
        });
    });

    describe('3. Loss of Pay (LOP) Calculation Formats & Methods', () => {
        it('should calculate fixed daily deduction amount correctly', async () => {
            vi.spyOn(LeaveCalculatorService, 'resolveLopPolicy').mockResolvedValueOnce({
                isAutoCalculationEnabled: true,
                calculationMethod: 'FIXED_AMOUNT',
                fixedDailyAmount: 1500,
                salaryBasis: 'MONTHLY_BASE_SALARY',
                divisorType: 'FIXED_DIVISOR',
                fixedDivisor: 30,
                currency: 'INR',
                roundingRule: 'ROUND_HALF_UP',
                requiresAdminApproval: true,
                lopPolicyDocument: null,
            });

            const deduction = await LeaveCalculatorService.calculateLopDeduction(
                mockCompanyId,
                mockEmployeeId,
                2.5, // 2.5 LOP days
                '2026-10-01'
            );

            // 2.5 * 1500 = 3750
            expect(deduction).toBe(3750);
        });

        it('should calculate salary divisor deduction correctly with custom salary and divisor', async () => {
            vi.spyOn(LeaveCalculatorService, 'resolveLopPolicy').mockResolvedValueOnce({
                isAutoCalculationEnabled: true,
                calculationMethod: 'SALARY_DIVISOR',
                fixedDailyAmount: 1000,
                salaryBasis: 'MONTHLY_BASE_SALARY',
                divisorType: 'FIXED_DIVISOR',
                fixedDivisor: 30,
                currency: 'INR',
                roundingRule: 'ROUND_HALF_UP',
                requiresAdminApproval: true,
                customSalary: 60000, // Monthly salary ₹60,000
                lopPolicyDocument: null,
            });

            // 60,000 / 30 = 2,000/day * 2 days = 4,000
            const deduction = await LeaveCalculatorService.calculateLopDeduction(
                mockCompanyId,
                mockEmployeeId,
                2,
                '2026-10-01'
            );

            expect(deduction).toBe(4000);
        });

        it('should handle zero or fractional LOP days gracefully', async () => {
            const deductionZero = await LeaveCalculatorService.calculateLopDeduction(
                mockCompanyId,
                mockEmployeeId,
                0,
                '2026-10-01'
            );
            expect(deductionZero).toBe(0);

            const deductionNegative = await LeaveCalculatorService.calculateLopDeduction(
                mockCompanyId,
                mockEmployeeId,
                -3,
                '2026-10-01'
            );
            expect(deductionNegative).toBe(0);
        });

        it('should calculate calendar days divisor for October (31 days)', async () => {
            vi.spyOn(LeaveCalculatorService, 'resolveLopPolicy').mockResolvedValueOnce({
                isAutoCalculationEnabled: true,
                calculationMethod: 'SALARY_DIVISOR',
                fixedDailyAmount: 1000,
                salaryBasis: 'MONTHLY_BASE_SALARY',
                divisorType: 'CALENDAR_DAYS_IN_MONTH',
                fixedDivisor: 30,
                currency: 'INR',
                roundingRule: 'ROUND_HALF_UP',
                requiresAdminApproval: true,
                customSalary: 31000,
                lopPolicyDocument: null,
            });

            // 31,000 / 31 = 1,000 per day * 1 day = 1,000
            const deduction = await LeaveCalculatorService.calculateLopDeduction(
                mockCompanyId,
                mockEmployeeId,
                1,
                '2026-10-15'
            );

            expect(deduction).toBe(1000);
        });
    });

    describe('4. Excess Leave Allocation & Multi-Month Policy Application', () => {
        it('should allocate eligible paid days vs excess LOP days for single month', async () => {
            vi.spyOn(LeaveCalculatorService, 'resolveActivePolicy').mockResolvedValue({
                monthlyLimit: 2,
                unusedLeavePolicy: 'EXPIRES',
                maxCarryForwardDays: 0,
                excessLeaveRule: 'CONVERT_TO_LOP',
                countWeekends: true,
                countHolidays: true,
                allowHalfDay: true,
                policyDocument: null,
            });

            vi.spyOn(LeaveCalculatorService, 'resolveLopPolicy').mockResolvedValue({
                isAutoCalculationEnabled: true,
                calculationMethod: 'FIXED_AMOUNT',
                fixedDailyAmount: 1000,
                salaryBasis: 'MONTHLY_BASE_SALARY',
                divisorType: 'FIXED_DIVISOR',
                fixedDivisor: 30,
                currency: 'INR',
                roundingRule: 'ROUND_HALF_UP',
                requiresAdminApproval: true,
                lopPolicyDocument: null,
            });

            // Request 4 days when limit is 2
            const result = await LeaveCalculatorService.allocateLeaveAcrossMonths(
                mockCompanyId,
                mockEmployeeId,
                '2026-10-01',
                '2026-10-04',
                LeaveDurationType.FULL_DAY,
                LeaveType.CASUAL
            );

            expect(result.totalDays).toBe(4);
            expect(result.eligiblePaidDays).toBe(2);
            expect(result.excessDays).toBe(2);
            expect(result.proposedLopDays).toBe(2);
            expect(result.estimatedDeduction).toBe(2000);
            expect(result.isLopApplicable).toBe(true);
        });

        it('should treat explicit UNPAID leave as 0 eligible paid days and 100% unpaid days', async () => {
            vi.spyOn(LeaveCalculatorService, 'resolveActivePolicy').mockResolvedValue({
                monthlyLimit: 0,
                unusedLeavePolicy: 'EXPIRES',
                maxCarryForwardDays: 0,
                excessLeaveRule: 'CONVERT_TO_UNPAID',
                countWeekends: true,
                countHolidays: true,
                allowHalfDay: true,
                policyDocument: null,
            });

            const result = await LeaveCalculatorService.allocateLeaveAcrossMonths(
                mockCompanyId,
                mockEmployeeId,
                '2026-10-01',
                '2026-10-03',
                LeaveDurationType.FULL_DAY,
                LeaveType.UNPAID
            );

            expect(result.totalDays).toBe(3);
            expect(result.eligiblePaidDays).toBe(0);
            expect(result.unpaidDays).toBe(3);
            expect(result.proposedLopDays).toBe(0);
        });
    });
});
