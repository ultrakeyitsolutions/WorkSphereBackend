import { Types, Document } from 'mongoose';
import { LeaveType, LeaveDurationType, HalfDayPeriod } from '../../attendance/attendance.types';

// ─── Unused Leave & Excess Leave Policies ──────────────────────────────────
export type UnusedLeavePolicy = 'EXPIRES' | 'CARRIES_FORWARD';
export type ExcessLeaveRule = 'REQUIRE_REVIEW' | 'CONVERT_TO_LOP' | 'CONVERT_TO_UNPAID';

// ─── LOP Calculation & Divisor Types ────────────────────────────────────────
export type LopCalculationMethod = 'FIXED_AMOUNT' | 'SALARY_DIVISOR';
export type SalaryBasis = 'MONTHLY_BASE_SALARY' | 'MONTHLY_GROSS_SALARY';
export type DivisorType = 'FIXED_DIVISOR' | 'CALENDAR_DAYS_IN_MONTH' | 'WORKING_DAYS_IN_MONTH';
export type RoundingRule = 'NONE' | 'ROUND_UP' | 'ROUND_DOWN' | 'ROUND_HALF_UP';
export type LopDecisionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'ADJUSTED';
export type EmailDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

// ─── Employee Overrides ─────────────────────────────────────────────────────
export interface IEmployeeLeavePolicyOverride {
    employeeId: Types.ObjectId;
    monthlyLimit: number;
    effectiveFrom: string; // YYYY-MM-DD
    effectiveTo?: string | null;
    reason?: string;
}

export interface IEmployeeLopOverride {
    employeeId: Types.ObjectId;
    calculationMethod?: LopCalculationMethod;
    fixedDailyAmount?: number;
    customSalary?: number;
    fixedDivisor?: number;
    reason?: string;
}

// ─── Leave Policy Interface ─────────────────────────────────────────────────
export interface ICompanyLeavePolicy {
    companyId: Types.ObjectId;
    leaveType: LeaveType;
    name: string;
    description?: string;
    monthlyLimit: number; // e.g. 2 paid days per month
    unusedLeavePolicy: UnusedLeavePolicy;
    maxCarryForwardDays?: number;
    excessLeaveRule: ExcessLeaveRule;
    countWeekends: boolean; // default false
    countHolidays: boolean; // default false
    allowHalfDay: boolean; // default true
    effectiveFrom: string; // YYYY-MM-DD
    effectiveTo?: string | null;
    isActive: boolean;
    employeeOverrides: IEmployeeLeavePolicyOverride[];
    createdBy?: Types.ObjectId | null;
    updatedBy?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICompanyLeavePolicyDocument extends ICompanyLeavePolicy, Document {
    _id: Types.ObjectId;
}

// ─── LOP Policy Interface ───────────────────────────────────────────────────
export interface ICompanyLopPolicy {
    companyId: Types.ObjectId;
    isAutoCalculationEnabled: boolean;
    calculationMethod: LopCalculationMethod;
    fixedDailyAmount: number; // in minor units or whole currency units (e.g. 500)
    salaryBasis: SalaryBasis;
    divisorType: DivisorType;
    fixedDivisor: number; // e.g. 30, 26, 22
    currency: string; // default 'INR'
    roundingRule: RoundingRule;
    requiresAdminApproval: boolean;
    effectiveFrom: string; // YYYY-MM-DD
    effectiveTo?: string | null;
    employeeOverrides: IEmployeeLopOverride[];
    createdBy?: Types.ObjectId | null;
    updatedBy?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICompanyLopPolicyDocument extends ICompanyLopPolicy, Document {
    _id: Types.ObjectId;
}

// ─── Monthly Leave Balance Interface ────────────────────────────────────────
export interface IEmployeeMonthlyLeaveBalance {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    month: string; // "YYYY-MM"
    leaveType: LeaveType;
    allocatedPaidDays: number;
    carriedForwardPaidDays: number;
    totalEligiblePaidDays: number; // allocated + carriedForward
    requestedDays: number; // total days in applications
    approvedPaidDays: number; // approved consumed paid days
    pendingPaidDays: number; // reserved for pending applications
    unpaidLeaveDays: number; // approved unpaid leave days
    lopDays: number; // approved LOP days
    rejectedCancelledDays: number;
    remainingPaidBalance: number; // totalEligiblePaidDays - approvedPaidDays
    availablePaidBalance: number; // totalEligiblePaidDays - approvedPaidDays - pendingPaidDays
    lastRecalculatedAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEmployeeMonthlyLeaveBalanceDocument extends IEmployeeMonthlyLeaveBalance, Document {
    _id: Types.ObjectId;
}

// ─── Month Breakdown on Leave Request ───────────────────────────────────────
export interface ILeaveMonthAllocation {
    month: string; // "YYYY-MM"
    totalDays: number;
    eligiblePaidDays: number;
    excessDays: number;
    proposedLopDays: number;
    unpaidDays: number;
    calendarDays: string[]; // "YYYY-MM-DD"
}

// ─── LOP Decision Interface ─────────────────────────────────────────────────
export interface ILopAuditTrailEntry {
    actorId: Types.ObjectId;
    action: 'PROPOSED' | 'ADJUSTED' | 'APPROVED' | 'REJECTED' | 'CORRECTION';
    reason?: string;
    previousAmount?: number;
    newAmount?: number;
    timestamp: Date;
}

export interface ILopDecision {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    leaveRequestId: Types.ObjectId;
    month: string; // "YYYY-MM"
    lopDays: number;
    calculationMethod: LopCalculationMethod;
    baseSalaryUsed: number | null;
    divisorUsed: number | null;
    currency: string;
    calculatedDeductionAmount: number;
    finalDeductionAmount: number;
    status: LopDecisionStatus;
    adminOverrideReason?: string | null;
    approvedBy?: Types.ObjectId | null;
    approvedAt?: Date | null;
    rejectionReason?: string | null;
    isEstimated: boolean;
    emailDeliveryStatus: EmailDeliveryStatus;
    emailDeliveryError?: string | null;
    emailSentAt?: Date | null;
    auditTrail: ILopAuditTrailEntry[];
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ILopDecisionDocument extends ILopDecision, Document {
    _id: Types.ObjectId;
}

// ─── Revision Request & Decision History on Leave Request ──────────────────
export interface ILeaveRevisionRequest {
    requestedBy: Types.ObjectId;
    notes: string;
    requestedAt: Date;
    status: 'PENDING' | 'RESOLVED';
}

export interface ILeaveDecisionHistoryEntry {
    action:
        | 'APPLIED'
        | 'APPROVED'
        | 'REJECTED'
        | 'CANCELLED'
        | 'REVISION_REQUESTED'
        | 'LOP_PROPOSED'
        | 'LOP_APPROVED'
        | 'LOP_REJECTED'
        | 'CORRECTION';
    actorId: Types.ObjectId;
    timestamp: Date;
    details?: string;
    snapshot?: Record<string, any>;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────
export interface UpsertLeavePolicyDto {
    leaveType: LeaveType;
    name?: string;
    description?: string;
    monthlyLimit: number;
    unusedLeavePolicy?: UnusedLeavePolicy;
    maxCarryForwardDays?: number;
    excessLeaveRule?: ExcessLeaveRule;
    countWeekends?: boolean;
    countHolidays?: boolean;
    allowHalfDay?: boolean;
    effectiveFrom: string;
    effectiveTo?: string | null;
    isActive?: boolean;
}

export interface UpdateLopPolicyDto {
    isAutoCalculationEnabled?: boolean;
    calculationMethod?: LopCalculationMethod;
    fixedDailyAmount?: number;
    salaryBasis?: SalaryBasis;
    divisorType?: DivisorType;
    fixedDivisor?: number;
    currency?: string;
    roundingRule?: RoundingRule;
    requiresAdminApproval?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string | null;
}

export interface SetEmployeePolicyOverrideDto {
    employeeId: string;
    monthlyLimit: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    reason?: string;
}

export interface SetEmployeeLopOverrideDto {
    employeeId: string;
    calculationMethod?: LopCalculationMethod;
    fixedDailyAmount?: number;
    customSalary?: number;
    fixedDivisor?: number;
    reason?: string;
}

export interface LeavePreviewRequestDto {
    leaveType: LeaveType;
    durationType?: LeaveDurationType;
    halfDayPeriod?: HalfDayPeriod;
    startDate: string;
    endDate: string;
    employeeId?: string;
}

export interface LeavePreviewResponse {
    startDate: string;
    endDate: string;
    leaveType: LeaveType;
    totalRequestedDays: number;
    totalEligiblePaidDays: number;
    totalExcessDays: number;
    totalProposedLopDays: number;
    totalUnpaidDays: number;
    estimatedDeduction: number;
    currency: string;
    isLopApplicable: boolean;
    monthBreakdown: ILeaveMonthAllocation[];
    activePolicy: {
        monthlyLimit: number;
        unusedLeavePolicy: UnusedLeavePolicy;
        excessLeaveRule: ExcessLeaveRule;
        countWeekends: boolean;
        countHolidays: boolean;
    };
    explanation: string;
}

export interface ApproveLeaveWithBreakdownDto {
    approvedPaidDays?: number;
    approvedUnpaidDays?: number;
    approvedLopDays?: number;
    customDeductionAmount?: number;
    notes?: string;
}

export interface RequestLeaveRevisionDto {
    notes: string;
}

export interface ApproveLopDecisionDto {
    finalDeductionAmount?: number;
    overrideReason?: string;
}
