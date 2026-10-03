import { Document, Types } from 'mongoose';

// ─── Shift Interfaces ──────────────────────────────────────────────────────────

export interface IShift {
    companyId: Types.ObjectId;
    name: string;
    code: string;
    startTime: string; // "HH:mm" (24-hour format, e.g. "09:00", "22:00")
    endTime: string;   // "HH:mm" (24-hour format, e.g. "17:30", "06:00")
    crossesMidnight: boolean;
    timezone: string;
    gracePeriodMinutes: number; // e.g. 10 mins
    earlyCheckoutGracePeriodMinutes: number; // e.g. 5 mins
    workingDays: number[]; // 1 = Monday ... 7 = Sunday
    halfDayThresholdMinutes?: number;
    fullDayThresholdMinutes?: number;
    isActive: boolean;
    isDefault: boolean;
    description?: string;
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

export interface IShiftDocument extends IShift, Document {}

// ─── Employee Shift Assignment Interfaces ─────────────────────────────────────

export type ShiftAssignmentStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'CANCELLED';

export interface IEmployeeShiftAssignment {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId; // References User._id
    shiftId: Types.ObjectId;    // References Shift._id
    effectiveFrom: Date;        // Inclusive start date (stored in UTC)
    effectiveTo?: Date | null;  // Inclusive end date (null = indefinitely active)
    assignedBy: Types.ObjectId; // References User._id
    reason?: string | null;
    status: ShiftAssignmentStatus;
    createdAt: Date;
    updatedAt: Date;
}

export interface IEmployeeShiftAssignmentDocument extends IEmployeeShiftAssignment, Document {}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface CreateShiftDto {
    name: string;
    code: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    gracePeriodMinutes?: number;
    earlyCheckoutGracePeriodMinutes?: number;
    workingDays?: number[];
    halfDayThresholdMinutes?: number;
    fullDayThresholdMinutes?: number;
    isActive?: boolean;
    isDefault?: boolean;
    description?: string;
}

export interface UpdateShiftDto {
    name?: string;
    code?: string;
    startTime?: string;
    endTime?: string;
    timezone?: string;
    gracePeriodMinutes?: number;
    earlyCheckoutGracePeriodMinutes?: number;
    workingDays?: number[];
    halfDayThresholdMinutes?: number;
    fullDayThresholdMinutes?: number;
    isActive?: boolean;
    isDefault?: boolean;
    description?: string;
}

export interface AssignShiftDto {
    employeeId: string;
    shiftId: string;
    effectiveFrom: string | Date;
    effectiveTo?: string | Date | null;
    reason?: string;
}

export interface BulkAssignShiftDto {
    employeeIds: string[];
    shiftId: string;
    effectiveFrom: string | Date;
    effectiveTo?: string | Date | null;
    reason?: string;
}

export interface ShiftListQuery {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean | string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface ShiftAssignmentListQuery {
    page?: number;
    limit?: number;
    search?: string;
    shiftId?: string;
    employeeId?: string;
    status?: ShiftAssignmentStatus;
    date?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// ─── Evaluation Types ─────────────────────────────────────────────────────────

export type AttendancePunchStatus = 'ON_TIME' | 'LATE' | 'HALF_DAY';
export type AttendanceCheckoutStatus = 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME';

export interface ResolvedEmployeeShift {
    shiftId: string;
    name: string;
    code: string;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    timezone: string;
    gracePeriodMinutes: number;
    earlyCheckoutGracePeriodMinutes: number;
    workingDays: number[];
    isAssigned: boolean;
    assignmentId?: string;
}

export interface CheckInEvaluationResult {
    punchStatus: AttendancePunchStatus;
    lateMinutes: number;
    scheduledStartTime: Date;
    scheduledEndTime: Date;
    attendanceDate: string; // YYYY-MM-DD
    isOvernight: boolean;
    shiftId: Types.ObjectId;
}

export interface CheckOutEvaluationResult {
    checkoutStatus: AttendanceCheckoutStatus;
    earlyDepartureMinutes: number;
    overtimeMinutes: number;
    workDurationMinutes: number;
    scheduledEndTime: Date;
}
