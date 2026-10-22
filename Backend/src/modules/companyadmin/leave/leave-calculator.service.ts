import mongoose, { Types } from 'mongoose';
import { TimezoneUtils } from '../../attendance/utils/timezone.utils';
import { Holiday } from '../../attendance/holiday.model';
import { AttendanceCalculationService } from '../../attendance/attendance-calculation.service';
import { EmployeeShiftAssignmentService } from '../../shifts/employee-shift-assignment.service';
import { CompanyLeavePolicy } from './leave-policy.model';
import { CompanyLopPolicy } from './lop-policy.model';
import { EmployeeMonthlyLeaveBalance } from './leave-balance.model';
import {
    ILeaveMonthAllocation,
    ICompanyLeavePolicyDocument,
    ICompanyLopPolicyDocument,
    RoundingRule,
    LopCalculationMethod,
} from './leave-policy.types';
import { LeaveType, LeaveDurationType } from '../../attendance/attendance.types';

export class LeaveCalculatorService {
    /**
     * Safely applies rounding rules to monetary numbers.
     */
    static roundAmount(amount: number, rule: RoundingRule = 'ROUND_HALF_UP'): number {
        if (!Number.isFinite(amount) || amount < 0) return 0;

        switch (rule) {
            case 'ROUND_UP':
                return Math.ceil(amount);
            case 'ROUND_DOWN':
                return Math.floor(amount);
            case 'ROUND_HALF_UP':
                return Math.round(amount);
            case 'NONE':
            default:
                return Math.round(amount * 100) / 100;
        }
    }

    /**
     * Calculates the working days for a leave request, taking into account
     * company holidays, weekends/week-offs, and policy settings.
     */
    static async calculateWorkingDays(
        companyId: string,
        employeeId: string,
        startDate: string,
        endDate: string,
        durationType: LeaveDurationType,
        policy: { countWeekends: boolean; countHolidays: boolean }
    ): Promise<{
        totalDays: number;
        monthMap: Record<string, string[]>; // "YYYY-MM" -> ["YYYY-MM-DD", ...]
    }> {
        const dates = TimezoneUtils.getDateRangeArray(startDate, endDate);
        const monthMap: Record<string, string[]> = {};

        // Fetch company holidays in the date range if policy excludes holidays
        let holidayDates = new Set<string>();
        if (!policy.countHolidays && mongoose.connection.readyState === 1) {
            try {
                const holidays = await Holiday.find({
                    companyId: new Types.ObjectId(companyId),
                    date: { $gte: startDate, $lte: endDate },
                }).select('date').lean();
                holidayDates = new Set(holidays.map((h) => h.date));
            } catch {
                holidayDates = new Set();
            }
        }

        // Resolve employee shift schedule if employeeId is available
        let resolvedShift: any = null;
        if (employeeId && Types.ObjectId.isValid(employeeId) && mongoose.connection.readyState === 1) {
            try {
                resolvedShift = await EmployeeShiftAssignmentService.resolveEmployeeShift(
                    companyId,
                    employeeId,
                    new Date(`${startDate}T12:00:00Z`)
                );
            } catch {
                resolvedShift = null;
            }
        }

        for (const dateStr of dates) {
            // Check holiday exclusion
            if (!policy.countHolidays && holidayDates.has(dateStr)) {
                continue;
            }

            // Check weekend/week-off exclusion
            if (!policy.countWeekends) {
                if (resolvedShift) {
                    const isWeekOff = AttendanceCalculationService.resolveWeekOff(dateStr, resolvedShift);
                    if (isWeekOff) {
                        continue;
                    }
                } else {
                    const dayOfWeek = TimezoneUtils.getDayOfWeekFromDateString(dateStr);
                    if (dayOfWeek === 6 || dayOfWeek === 7) {
                        continue;
                    }
                }
            }

            const monthKey = dateStr.slice(0, 7); // "YYYY-MM"
            if (!monthMap[monthKey]) {
                monthMap[monthKey] = [];
            }
            monthMap[monthKey].push(dateStr);
        }

        let totalDays = 0;
        for (const days of Object.values(monthMap)) {
            totalDays += days.length;
        }

        if (durationType === LeaveDurationType.HALF_DAY && totalDays > 0) {
            totalDays = 0.5;
        }

        return { totalDays, monthMap };
    }

    /**
     * Resolves the active leave policy for a company, leave type, and specific date/month.
     * Applies employee-specific policy overrides if present and active.
     */
    static async resolveActivePolicy(
        companyId: string,
        leaveType: LeaveType,
        dateStr: string,
        employeeId?: string
    ): Promise<{
        monthlyLimit: number;
        unusedLeavePolicy: 'EXPIRES' | 'CARRIES_FORWARD';
        maxCarryForwardDays: number;
        excessLeaveRule: 'REQUIRE_REVIEW' | 'CONVERT_TO_LOP' | 'CONVERT_TO_UNPAID';
        countWeekends: boolean;
        countHolidays: boolean;
        allowHalfDay: boolean;
        policyDocument: ICompanyLeavePolicyDocument | null;
    }> {
        let policy: any = null;
        if (mongoose.connection.readyState === 1) {
            try {
                policy = await CompanyLeavePolicy.findOne({
                    companyId: new Types.ObjectId(companyId),
                    leaveType,
                    isActive: true,
                    effectiveFrom: { $lte: dateStr },
                    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: dateStr } }],
                }).sort({ effectiveFrom: -1 });
            } catch {
                policy = null;
            }
        }

        // Fallback default policy if none configured
        const defaults = {
            monthlyLimit: leaveType === LeaveType.UNPAID ? 0 : 1.5,
            unusedLeavePolicy: 'EXPIRES' as const,
            maxCarryForwardDays: 0,
            excessLeaveRule: (leaveType === LeaveType.UNPAID
                ? ('CONVERT_TO_UNPAID' as const)
                : ('REQUIRE_REVIEW' as const)),
            countWeekends: false,
            countHolidays: false,
            allowHalfDay: true,
            policyDocument: policy,
        };

        if (!policy) return defaults;

        let monthlyLimit = policy.monthlyLimit;

        // Check employee-specific override
        if (employeeId && policy.employeeOverrides && policy.employeeOverrides.length > 0) {
            const override = policy.employeeOverrides.find(
                (o: any) =>
                    o.employeeId.toString() === employeeId &&
                    o.effectiveFrom <= dateStr &&
                    (!o.effectiveTo || o.effectiveTo >= dateStr)
            );
            if (override) {
                monthlyLimit = override.monthlyLimit;
            }
        }

        return {
            monthlyLimit,
            unusedLeavePolicy: policy.unusedLeavePolicy,
            maxCarryForwardDays: policy.maxCarryForwardDays || 0,
            excessLeaveRule: policy.excessLeaveRule,
            countWeekends: policy.countWeekends ?? false,
            countHolidays: policy.countHolidays ?? false,
            allowHalfDay: policy.allowHalfDay ?? true,
            policyDocument: policy,
        };
    }

    /**
     * Resolves the active LOP policy for a company and employee.
     */
    static async resolveLopPolicy(
        companyId: string,
        dateStr: string,
        employeeId?: string
    ): Promise<{
        isAutoCalculationEnabled: boolean;
        calculationMethod: LopCalculationMethod;
        fixedDailyAmount: number;
        salaryBasis: string;
        divisorType: string;
        fixedDivisor: number;
        currency: string;
        roundingRule: RoundingRule;
        requiresAdminApproval: boolean;
        customSalary?: number;
        lopPolicyDocument: ICompanyLopPolicyDocument | null;
    }> {
        let lopPolicy: any = null;
        if (mongoose.connection.readyState === 1) {
            try {
                lopPolicy = await CompanyLopPolicy.findOne({
                    companyId: new Types.ObjectId(companyId),
                    effectiveFrom: { $lte: dateStr },
                    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: dateStr } }],
                }).sort({ effectiveFrom: -1 });
            } catch {
                lopPolicy = null;
            }
        }

        const defaults = {
            isAutoCalculationEnabled: true,
            calculationMethod: 'SALARY_DIVISOR' as LopCalculationMethod,
            fixedDailyAmount: 1000,
            salaryBasis: 'MONTHLY_BASE_SALARY',
            divisorType: 'FIXED_DIVISOR',
            fixedDivisor: 30,
            currency: 'INR',
            roundingRule: 'ROUND_HALF_UP' as RoundingRule,
            requiresAdminApproval: true,
            lopPolicyDocument: lopPolicy,
        };

        if (!lopPolicy) return defaults;

        let calculationMethod = lopPolicy.calculationMethod;
        let fixedDailyAmount = lopPolicy.fixedDailyAmount;
        let fixedDivisor = lopPolicy.fixedDivisor || 30;
        let customSalary: number | undefined;

        if (employeeId && lopPolicy.employeeOverrides && lopPolicy.employeeOverrides.length > 0) {
            const override = lopPolicy.employeeOverrides.find(
                (o: any) => o.employeeId.toString() === employeeId
            );
            if (override) {
                if (override.calculationMethod) calculationMethod = override.calculationMethod;
                if (override.fixedDailyAmount != null) fixedDailyAmount = override.fixedDailyAmount;
                if (override.fixedDivisor != null) fixedDivisor = override.fixedDivisor;
                if (override.customSalary != null) customSalary = override.customSalary;
            }
        }

        return {
            isAutoCalculationEnabled: lopPolicy.isAutoCalculationEnabled ?? true,
            calculationMethod,
            fixedDailyAmount,
            salaryBasis: lopPolicy.salaryBasis,
            divisorType: lopPolicy.divisorType,
            fixedDivisor: Math.max(1, fixedDivisor),
            currency: lopPolicy.currency || 'INR',
            roundingRule: lopPolicy.roundingRule || 'ROUND_HALF_UP',
            requiresAdminApproval: lopPolicy.requiresAdminApproval ?? true,
            customSalary,
            lopPolicyDocument: lopPolicy,
        };
    }

    /**
     * Splits a leave duration across months and calculates eligible paid vs excess days
     * based on active policy and current available balance.
     */
    static async allocateLeaveAcrossMonths(
        companyId: string,
        employeeId: string,
        startDate: string,
        endDate: string,
        durationType: LeaveDurationType,
        leaveType: LeaveType
    ): Promise<{
        monthBreakdown: ILeaveMonthAllocation[];
        totalDays: number;
        eligiblePaidDays: number;
        excessDays: number;
        proposedLopDays: number;
        unpaidDays: number;
        estimatedDeduction: number;
        currency: string;
        isLopApplicable: boolean;
        activePolicy: any;
    }> {
        const sampleDate = startDate;
        const policyResolution = await this.resolveActivePolicy(
            companyId,
            leaveType,
            sampleDate,
            employeeId
        );

        const { totalDays, monthMap } = await this.calculateWorkingDays(
            companyId,
            employeeId,
            startDate,
            endDate,
            durationType,
            policyResolution
        );

        const monthBreakdown: ILeaveMonthAllocation[] = [];
        let totalEligiblePaidDays = 0;
        let totalExcessDays = 0;
        let totalProposedLopDays = 0;
        let totalUnpaidDays = 0;

        const isUnpaidType = leaveType === LeaveType.UNPAID;

        // Process each month in sorted order
        const sortedMonths = Object.keys(monthMap).sort();

        for (const monthKey of sortedMonths) {
            const daysInMonth = monthMap[monthKey];
            let requestedMonthDays = daysInMonth.length;
            if (durationType === LeaveDurationType.HALF_DAY) {
                requestedMonthDays = 0.5;
            }

            if (isUnpaidType) {
                // For explicit Unpaid Leave, all days are recorded as unpaid
                monthBreakdown.push({
                    month: monthKey,
                    totalDays: requestedMonthDays,
                    eligiblePaidDays: 0,
                    excessDays: 0,
                    proposedLopDays: 0,
                    unpaidDays: requestedMonthDays,
                    calendarDays: daysInMonth,
                });
                totalUnpaidDays += requestedMonthDays;
                continue;
            }

            // Fetch or resolve available paid leave balance for this employee and month
            let balanceRecord: any = null;
            if (mongoose.connection.readyState === 1) {
                try {
                    balanceRecord = await EmployeeMonthlyLeaveBalance.findOne({
                        companyId: new Types.ObjectId(companyId),
                        employeeId: new Types.ObjectId(employeeId),
                        month: monthKey,
                        leaveType,
                    });
                } catch {
                    balanceRecord = null;
                }
            }

            const monthPolicy = await this.resolveActivePolicy(
                companyId,
                leaveType,
                `${monthKey}-01`,
                employeeId
            );

            // Available paid balance: totalEligiblePaidDays - approvedPaidDays - pendingPaidDays
            let availableBalance = monthPolicy.monthlyLimit;
            if (balanceRecord) {
                availableBalance = Math.max(0, balanceRecord.availablePaidBalance);
            }

            let eligiblePaid = 0;
            let excess = 0;
            let proposedLop = 0;
            let unpaid = 0;

            if (requestedMonthDays <= availableBalance) {
                eligiblePaid = requestedMonthDays;
            } else {
                eligiblePaid = availableBalance;
                excess = requestedMonthDays - availableBalance;

                if (monthPolicy.excessLeaveRule === 'CONVERT_TO_LOP') {
                    proposedLop = excess;
                } else if (monthPolicy.excessLeaveRule === 'CONVERT_TO_UNPAID') {
                    unpaid = excess;
                } else {
                    // REQUIRE_REVIEW: Propose LOP for admin confirmation
                    proposedLop = excess;
                }
            }

            monthBreakdown.push({
                month: monthKey,
                totalDays: requestedMonthDays,
                eligiblePaidDays: eligiblePaid,
                excessDays: excess,
                proposedLopDays: proposedLop,
                unpaidDays: unpaid,
                calendarDays: daysInMonth,
            });

            totalEligiblePaidDays += eligiblePaid;
            totalExcessDays += excess;
            totalProposedLopDays += proposedLop;
            totalUnpaidDays += unpaid;
        }

        // Calculate estimated deduction for proposed LOP days
        let estimatedDeduction = 0;
        let currency = 'INR';
        const lopPolicy = await this.resolveLopPolicy(companyId, sampleDate, employeeId);
        currency = lopPolicy.currency;

        if (totalProposedLopDays > 0 && lopPolicy.isAutoCalculationEnabled) {
            estimatedDeduction = await this.calculateLopDeduction(
                companyId,
                employeeId,
                totalProposedLopDays,
                sampleDate
            );
        }

        return {
            monthBreakdown,
            totalDays,
            eligiblePaidDays: totalEligiblePaidDays,
            excessDays: totalExcessDays,
            proposedLopDays: totalProposedLopDays,
            unpaidDays: totalUnpaidDays,
            estimatedDeduction,
            currency,
            isLopApplicable: totalProposedLopDays > 0,
            activePolicy: policyResolution,
        };
    }

    /**
     * Calculates LOP deduction amount using configured policy and employee salary data.
     */
    static async calculateLopDeduction(
        companyId: string,
        employeeId: string,
        lopDays: number,
        dateStr: string
    ): Promise<number> {
        if (lopDays <= 0) return 0;

        const lopPolicy = await this.resolveLopPolicy(companyId, dateStr, employeeId);

        if (lopPolicy.calculationMethod === 'FIXED_AMOUNT') {
            const raw = lopDays * lopPolicy.fixedDailyAmount;
            return this.roundAmount(raw, lopPolicy.roundingRule);
        }

        // SALARY_DIVISOR method:
        // Use customSalary if configured in override, or fallback to fixed amount
        const monthlySalary = lopPolicy.customSalary || 0;

        if (!monthlySalary || monthlySalary <= 0) {
            // If no explicit employee salary configured, fallback gracefully to fixed daily amount
            const fallbackRaw = lopDays * (lopPolicy.fixedDailyAmount || 1000);
            return this.roundAmount(fallbackRaw, lopPolicy.roundingRule);
        }

        let divisor = lopPolicy.fixedDivisor || 30;

        if (lopPolicy.divisorType === 'CALENDAR_DAYS_IN_MONTH') {
            const [y, m] = dateStr.split('-').map(Number);
            divisor = new Date(y, m, 0).getDate(); // days in month
        } else if (lopPolicy.divisorType === 'WORKING_DAYS_IN_MONTH') {
            divisor = 22; // standard monthly working days
        }

        divisor = Math.max(1, divisor);
        const perDaySalary = monthlySalary / divisor;
        const rawAmount = perDaySalary * lopDays;

        return this.roundAmount(rawAmount, lopPolicy.roundingRule);
    }
}
export default LeaveCalculatorService;
