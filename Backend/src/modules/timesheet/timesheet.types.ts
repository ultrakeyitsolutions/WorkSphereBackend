import { Types } from 'mongoose';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum TimesheetApprovalStatus {
    DRAFT = 'DRAFT',
    SUBMITTED = 'SUBMITTED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    LOCKED = 'LOCKED'
}

export enum AnomalySeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH'
}

export enum AnomalyType {
    LONG_BREAK = 'LONG_BREAK',
    EXCESSIVE_IDLE = 'EXCESSIVE_IDLE',
    NO_TASK_ASSIGNED = 'NO_TASK_ASSIGNED',
    MISSING_CHECKOUT = 'MISSING_CHECKOUT',
    EXCESSIVE_HOURS = 'EXCESSIVE_HOURS',
    FREQUENT_PAUSE_RESUME = 'FREQUENT_PAUSE_RESUME'
}

export enum TimesheetHealthStatus {
    GOOD = 'GOOD',
    ATTENTION = 'ATTENTION',
    CRITICAL = 'CRITICAL'
}

// ─── Health Summary ───────────────────────────────────────────────────────────

export interface TimesheetHealthSummary {
    status: TimesheetHealthStatus;
    /** 0-100. Starts at 100, reduced per anomaly severity. */
    score: number;
    /** Number of active anomalies for the period */
    flags: number;
}

// ─── Anomaly ──────────────────────────────────────────────────────────────────

export interface AnomalyRecord {
    type: AnomalyType;
    severity: AnomalySeverity;
    title: string;
    description: string;
    /** ISO timestamp when the anomaly condition was detected / started */
    timestamp: string;
    /** Duration in hours relevant to the anomaly (e.g. idle hours) */
    duration?: number;
    taskId?: string | null;
    projectId?: string | null;
}

// ─── Productivity Metrics (one user x one calendar day) ──────────────────────

export interface ProductivityMetrics {
    /** Hours worked on tasks (WORK intervals only) */
    productionHours: number;
    /** Hours in break/hold state (BREAK + HOLD intervals) */
    breakHours: number;
    /** Remaining unclassified checked-in time */
    idleHours: number;
    /**
     * Always 0 - no meeting task type exists yet.
     * Placeholder for future use.
     */
    meetingHours: 0;
    /**
     * Always 0 - no efficient/inefficient source exists.
     * Must NOT be derived from productivityScore.
     */
    efficientHours: 0;
    /**
     * Always 0 - no efficient/inefficient source exists.
     * Must NOT be derived from productivityScore.
     */
    inefficientHours: 0;
    /** Overtime hours beyond the regular threshold (default 8h) */
    overtimeHours: number;
    /** checkOut minus checkIn in hours (or now if still checked in) */
    totalWorkHours: number;
    /** (productionHours / totalWorkHours) x 100, capped [0,100] */
    productivityScore: number;
    /** ((productionHours + meetingHours) / totalWorkHours) x 100, capped [0,100] */
    utilizationPercentage: number;
}

// ─── Overtime ─────────────────────────────────────────────────────────────────

export interface OvertimeRecord {
    regularHours: number;
    overtimeHours: number;
    totalWorkHours: number;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineEventKind =
    | 'CHECK_IN'
    | 'CHECK_OUT'
    | 'TASK_STARTED'
    | 'TASK_PAUSED'
    | 'TASK_RESUMED'
    | 'TASK_HELD'
    | 'TASK_COMPLETED'
    | 'TASK_CANCELLED';

export interface TimelineEntry {
    timestamp: string;
    kind: TimelineEventKind;
    title: string;
    description: string;
    taskId?: string | null;
    taskTitle?: string | null;
    projectId?: string | null;
    projectName?: string | null;
}

// ─── Project Distribution ─────────────────────────────────────────────────────

export interface ProjectDistribution {
    projectId: string;
    projectName: string;
    totalHours: number;
    /** productionHours for this project as % of total production across all projects */
    percentageOfTrackedTime: number;
}

// ─── Period Comparison ────────────────────────────────────────────────────────

export interface ComparisonMetric {
    metric: string;
    currentValue: number;
    previousValue: number;
    /** ((current - previous) / previous) x 100, null if previous = 0 */
    percentageChange: number | null;
    trend: 'UP' | 'DOWN' | 'FLAT';
}

// ─── Daily Summary ────────────────────────────────────────────────────────────

export interface TimesheetDayData extends ProductivityMetrics {
    date: string; // YYYY-MM-DD
    checkInTime: string | null;  // ISO
    checkOutTime: string | null; // ISO (or null if still checked in)
    timesheetHealth: TimesheetHealthSummary;
    anomalies: AnomalyRecord[];
    /** Chronological activity events for the day */
    activities: TimelineEntry[];
}

// ─── Per-User Summary (across a date range) ───────────────────────────────────

export interface TimesheetUserSummary {
    userId: string;
    fullName: string;
    email: string;
    avatar: string | null;
    timesheetHealth: TimesheetHealthSummary;
    /** Keyed by YYYY-MM-DD */
    dailyHours: Record<string, TimesheetDayData>;
    // Aggregated totals across the date range
    totalProductionHours: number;
    totalBreakHours: number;
    totalIdleHours: number;
    totalMeetingHours: 0;
    totalEfficientHours: 0;
    totalInefficientHours: 0;
    totalOvertimeHours: number;
    totalWorkHours: number;
}

// ─── Full Timesheet Response ──────────────────────────────────────────────────

export interface TimesheetResponse {
    startDate: string;
    endDate: string;
    users: TimesheetUserSummary[];
    grandTotalProductionHours: number;
    grandTotalBreakHours: number;
    grandTotalIdleHours: number;
    grandTotalMeetingHours: 0;
    grandTotalOvertimeHours: number;
    grandTotalWorkHours: number;
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}

// ─── Query Filter (internal, already validated) ───────────────────────────────

export interface TimesheetFilter {
    startDate: Date;
    endDate: Date;
    employeeId?: string;
    projectId?: string;
    page: number;
    pageSize: number;
}

export interface PeriodFilter {
    startDate: Date;
    endDate: Date;
}
