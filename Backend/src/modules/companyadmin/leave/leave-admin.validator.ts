import { z } from 'zod';

export const leaveTypeEnum = z.enum([
    'CASUAL',
    'SICK',
    'PAID',
    'UNPAID',
    'MATERNITY',
    'PATERNITY',
    'COMPENSATORY',
    'OTHER',
]);

export const unusedLeavePolicyEnum = z.enum(['EXPIRES', 'CARRIES_FORWARD']);
export const excessLeaveRuleEnum = z.enum(['REQUIRE_REVIEW', 'CONVERT_TO_LOP', 'CONVERT_TO_UNPAID']);
export const lopCalculationMethodEnum = z.enum(['FIXED_AMOUNT', 'SALARY_DIVISOR']);
export const salaryBasisEnum = z.enum(['MONTHLY_BASE_SALARY', 'MONTHLY_GROSS_SALARY']);
export const divisorTypeEnum = z.enum(['FIXED_DIVISOR', 'CALENDAR_DAYS_IN_MONTH', 'WORKING_DAYS_IN_MONTH']);
export const roundingRuleEnum = z.enum(['NONE', 'ROUND_UP', 'ROUND_DOWN', 'ROUND_HALF_UP']);

export const upsertLeavePolicySchema = z.object({
    body: z.object({
        leaveType: leaveTypeEnum,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        monthlyLimit: z.number().min(0).max(31),
        unusedLeavePolicy: unusedLeavePolicyEnum.optional(),
        maxCarryForwardDays: z.number().min(0).max(365).optional(),
        excessLeaveRule: excessLeaveRuleEnum.optional(),
        countWeekends: z.boolean().optional(),
        countHolidays: z.boolean().optional(),
        allowHalfDay: z.boolean().optional(),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
        effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
        isActive: z.boolean().optional(),
    }).passthrough(),
});

export const updateLopPolicySchema = z.object({
    body: z.object({
        isAutoCalculationEnabled: z.boolean().optional(),
        calculationMethod: lopCalculationMethodEnum.optional(),
        fixedDailyAmount: z.number().min(0).optional(),
        salaryBasis: salaryBasisEnum.optional(),
        divisorType: divisorTypeEnum.optional(),
        fixedDivisor: z.number().min(1).max(365).optional(),
        currency: z.string().min(1).max(10).optional(),
        roundingRule: roundingRuleEnum.optional(),
        requiresAdminApproval: z.boolean().optional(),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
        effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
    }).passthrough(),
});

export const setEmployeePolicyOverrideSchema = z.object({
    body: z.object({
        employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format'),
        monthlyLimit: z.number().min(0).max(31),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
        effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').nullable().optional(),
        reason: z.string().max(300).optional(),
    }).passthrough(),
});

export const setEmployeeLopOverrideSchema = z.object({
    body: z.object({
        employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format'),
        calculationMethod: lopCalculationMethodEnum.optional(),
        fixedDailyAmount: z.number().min(0).optional(),
        customSalary: z.number().min(0).optional(),
        fixedDivisor: z.number().min(1).max(365).optional(),
        reason: z.string().max(300).optional(),
    }).passthrough(),
});

export const leavePreviewSchema = z.object({
    query: z.object({
        leaveType: leaveTypeEnum,
        durationType: z.enum(['FULL_DAY', 'HALF_DAY']).optional(),
        halfDayPeriod: z.enum(['FIRST_HALF', 'SECOND_HALF']).optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
        employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format').optional(),
    }),
});

export const approveLeaveWithBreakdownSchema = z.object({
    body: z.preprocess((val: any) => {
        if (val && typeof val === 'object') {
            return {
                ...val,
                approvedPaidDays: val.approvedPaidDays ?? val.paidDays,
                approvedUnpaidDays: val.approvedUnpaidDays ?? val.unpaidDays,
                approvedLopDays: val.approvedLopDays ?? val.lopDays,
                notes: val.notes || val.remarks || val.reason || undefined,
            };
        }
        return val;
    }, z.object({
        approvedPaidDays: z.number().min(0).optional(),
        approvedUnpaidDays: z.number().min(0).optional(),
        approvedLopDays: z.number().min(0).optional(),
        customDeductionAmount: z.number().min(0).optional(),
        notes: z.string().max(1000).optional(),
        remarks: z.string().max(1000).optional(),
    }).passthrough()),
});

export const requestLeaveRevisionSchema = z.object({
    body: z.preprocess((val: any) => {
        if (val && typeof val === 'object') {
            const notes = val.notes || val.message || val.reason || '';
            return {
                ...val,
                notes,
            };
        }
        return val;
    }, z.object({
        notes: z.string().min(1, 'Revision message/notes required').max(1000),
        message: z.string().max(1000).optional(),
        reason: z.string().max(1000).optional(),
        suggestedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
        suggestedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    }).passthrough()),
});

export const approveLopDecisionSchema = z.object({
    body: z.preprocess((val: any) => {
        if (val && typeof val === 'object') {
            return {
                ...val,
                overrideReason: val.overrideReason || val.adminRemarks || val.remarks || val.reason || undefined,
            };
        }
        return val;
    }, z.object({
        finalDeductionAmount: z.number().min(0).optional(),
        overrideReason: z.string().max(1000).optional(),
        adminRemarks: z.string().max(1000).optional(),
        remarks: z.string().max(1000).optional(),
    }).passthrough()),
});

