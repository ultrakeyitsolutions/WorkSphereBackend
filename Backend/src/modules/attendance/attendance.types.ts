import { Document, Types } from 'mongoose';

// ─── Attendance Primary Status Enum ──────────────────────────────────────────
export enum AttendanceStatus {
    PRESENT = 'PRESENT',
    ABSENT = 'ABSENT',
    HALF_DAY = 'HALF_DAY',
    LEAVE = 'LEAVE',
    HOLIDAY = 'HOLIDAY',
    WEEK_OFF = 'WEEK_OFF',
    PENDING = 'PENDING',
    // Compatibility aliases for legacy services
    CHECKED_IN = 'CHECKED_IN',
    CHECKED_OUT = 'CHECKED_OUT',
}

// ─── Punch / Checkout Granular Status ─────────────────────────────────────────
export type PunchStatus = 'ON_TIME' | 'LATE' | 'HALF_DAY';
export type CheckoutStatus = 'ON_TIME' | 'EARLY_OUT' | 'OVERTIME';

// ─── Attendance Event Type ───────────────────────────────────────────────────
export enum AttendanceEventType {
    CHECK_IN = 'CHECK_IN',
    CHECK_OUT = 'CHECK_OUT',
    BREAK_START = 'BREAK_START',
    BREAK_END = 'BREAK_END',
}

// ─── Leave Types & Statuses ──────────────────────────────────────────────────
export enum LeaveType {
    CASUAL = 'CASUAL',
    SICK = 'SICK',
    PAID = 'PAID',
    UNPAID = 'UNPAID',
    MATERNITY = 'MATERNITY',
    PATERNITY = 'PATERNITY',
    COMPENSATORY = 'COMPENSATORY',
    OTHER = 'OTHER',
}

export enum LeaveDurationType {
    FULL_DAY = 'FULL_DAY',
    HALF_DAY = 'HALF_DAY',
}

export enum HalfDayPeriod {
    FIRST_HALF = 'FIRST_HALF',
    SECOND_HALF = 'SECOND_HALF',
}

export enum LeaveStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    CANCELLED = 'CANCELLED',
}

// ─── Attendance Adjustment Status ────────────────────────────────────────────
export enum AdjustmentStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

// ─── Scheduled & Actual Details Interfaces ───────────────────────────────────
export interface IScheduledShiftDetails {
    startTime: Date | null;
    endTime: Date | null;
    workingMinutes: number;
}

export interface IActualAttendanceDetails {
    firstCheckIn: Date | null;
    lastCheckOut: Date | null;
    workedMinutes: number;
}

export interface IAttendanceMetrics {
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
}

export interface IAttendanceLeaveDetails {
    leaveId: Types.ObjectId | null;
    leaveType: LeaveType | string | null;
    durationType?: LeaveDurationType | string | null;
}

export interface IAttendanceHolidayDetails {
    holidayId: Types.ObjectId | null;
    holidayName: string | null;
}

// ─── Attendance Document Interface ───────────────────────────────────────────
export interface IAttendanceDocument extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    userId: Types.ObjectId; // Alias for employeeId for backwards compatibility
    date: string; // "YYYY-MM-DD" in company timezone
    status: AttendanceStatus;
    shiftId: Types.ObjectId | null;
    scheduled: IScheduledShiftDetails;
    actual: IActualAttendanceDetails;
    metrics: IAttendanceMetrics;
    leave: IAttendanceLeaveDetails;
    holiday: IAttendanceHolidayDetails;
    source: string; // 'WEB' | 'MOBILE' | 'BIOMETRIC' | 'API' | 'AUTO' | 'ADJUSTMENT'
    punchStatus?: PunchStatus;
    checkoutStatus?: CheckoutStatus;
    isOvernight?: boolean;
    isFinalized?: boolean;
    notes?: string;

    // Direct / legacy compatibility properties
    checkInTime: Date;
    checkOutTime?: Date;
    attendanceDate?: string;
    workDurationMinutes?: number;
    lateMinutes?: number;
    earlyDepartureMinutes?: number;
    overtimeMinutes?: number;
    scheduledStartTime?: Date;
    scheduledEndTime?: Date;

    createdAt: Date;
    updatedAt: Date;
}

// ─── Attendance Event Document Interface ──────────────────────────────────────
export interface IAttendanceEventDocument extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    attendanceId: Types.ObjectId;
    type: AttendanceEventType;
    timestamp: Date;
    source: string;
    deviceId?: string | null;
    ipAddress?: string | null;
    location?: {
        latitude?: number | null;
        longitude?: number | null;
        accuracy?: number | null;
        address?: string | null;
    };
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Holiday Document Interface ──────────────────────────────────────────────
export interface IHolidayDocument extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    name: string;
    date: string; // "YYYY-MM-DD"
    description?: string;
    isRecurring: boolean;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Leave Request Document Interface ────────────────────────────────────────
export interface ILeaveRequestDocument extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    leaveType: LeaveType;
    durationType: LeaveDurationType;
    halfDayPeriod?: HalfDayPeriod | null;
    startDate: string; // "YYYY-MM-DD"
    endDate: string;   // "YYYY-MM-DD"
    totalDays: number;
    reason: string;
    status: LeaveStatus;
    appliedAt: Date;
    approvedBy?: Types.ObjectId | null;
    approvedAt?: Date | null;
    rejectionReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Attendance Adjustment Document Interface ────────────────────────────────
export interface IAttendanceAdjustmentDocument extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    attendanceId: Types.ObjectId;
    date: string; // "YYYY-MM-DD"
    oldValues: {
        status: AttendanceStatus | string;
        firstCheckIn?: Date | null;
        lastCheckOut?: Date | null;
        workedMinutes?: number;
    };
    requestedValues: {
        status?: AttendanceStatus | string;
        firstCheckIn?: Date | null;
        lastCheckOut?: Date | null;
        workedMinutes?: number;
    };
    reason: string;
    requestedBy: Types.ObjectId;
    status: AdjustmentStatus;
    approvedBy?: Types.ObjectId | null;
    approvedAt?: Date | null;
    rejectionReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

// ─── DTO Interfaces ──────────────────────────────────────────────────────────
export interface CheckInDto {
    timestamp?: Date | string;
    source?: string;
    deviceId?: string;
    location?: {
        latitude?: number;
        longitude?: number;
        accuracy?: number;
        address?: string;
    };
    notes?: string;
}

export interface CheckOutDto {
    timestamp?: Date | string;
    source?: string;
    deviceId?: string;
    location?: {
        latitude?: number;
        longitude?: number;
        accuracy?: number;
        address?: string;
    };
    notes?: string;
}

export interface BreakEventDto {
    timestamp?: Date | string;
    source?: string;
    notes?: string;
}

export interface ApplyLeaveDto {
    leaveType: LeaveType;
    durationType?: LeaveDurationType;
    halfDayPeriod?: HalfDayPeriod;
    startDate: string; // "YYYY-MM-DD"
    endDate: string;   // "YYYY-MM-DD"
    reason: string;
}

export interface CreateHolidayDto {
    name: string;
    date: string; // "YYYY-MM-DD"
    description?: string;
    isRecurring?: boolean;
}

export interface RequestAdjustmentDto {
    attendanceId: string;
    date: string; // "YYYY-MM-DD"
    status?: AttendanceStatus;
    firstCheckIn?: Date | string;
    lastCheckOut?: Date | string;
    reason: string;
}

export interface CalendarQueryDto {
    startDate?: string;
    endDate?: string;
    month?: number | string; // 1-12
    year?: number | string;
    page?: number | string;
    limit?: number | string;
}

export interface AttendanceSummaryQueryDto {
    startDate?: string;
    endDate?: string;
    period?: 'weekly' | 'monthly' | 'custom';
    month?: number | string;
    year?: number | string;
}

export interface AdminAttendanceListQueryDto {
    date?: string; // "YYYY-MM-DD"
    department?: string;
    project?: string;
    employeeId?: string;
    status?: AttendanceStatus | string;
    search?: string;
    page?: number | string;
    limit?: number | string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface AttendanceReportQueryDto {
    date?: string;
    startDate?: string;
    endDate?: string;
    month?: number | string;
    year?: number | string;
    departmentId?: string;
    employeeId?: string;
}
