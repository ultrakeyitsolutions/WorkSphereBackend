import { Types } from 'mongoose';

// ─── Presence Status ─────────────────────────────────────────────────────────
export type PresenceStatus = 'ONLINE' | 'OFFLINE';

export type EmployeeWorkStatus =
    | 'WORKING'
    | 'ON_BREAK'
    | 'IN_MEETING'
    | 'ON_LEAVE'
    | 'IDLE'
    | 'OFFLINE'
    | 'NOT_RECORDED';

// ─── Monitoring Event Types ──────────────────────────────────────────────────
export enum MonitoringEventType {
    // Task events
    TASK_STARTED = 'task.started',
    TASK_STATUS_CHANGED = 'task.status_changed',
    TASK_COMPLETED = 'task.completed',
    TASK_SUBMITTED_FOR_REVIEW = 'task.submitted_for_review',
    TASK_ASSIGNED = 'task.assigned',
    TASK_UNASSIGNED = 'task.unassigned',
    TASK_BLOCKED = 'task.blocked',
    TASK_UNBLOCKED = 'task.unblocked',
    TASK_ATTACHMENT_UPLOADED = 'task.attachment_uploaded',

    // Attendance events
    ATTENDANCE_CHECKED_IN = 'attendance.checked_in',
    ATTENDANCE_CHECKED_OUT = 'attendance.checked_out',
    BREAK_STARTED = 'break.started',
    BREAK_ENDED = 'break.ended',

    // Meeting events
    MEETING_STARTED = 'meeting.started',
    MEETING_ENDED = 'meeting.ended',
    MEETING_PARTICIPANT_JOINED = 'meeting.participant_joined',
    MEETING_PARTICIPANT_LEFT = 'meeting.participant_left',

    // Project events
    PROJECT_STATUS_CHANGED = 'project.status_changed',

    // Presence & Employee events
    PRESENCE_ONLINE = 'presence.online',
    PRESENCE_OFFLINE = 'presence.offline',
    EMPLOYEE_STATUS_CHANGED = 'employee.status_changed',

    // Alert events
    ALERT_CREATED = 'alert.created',
    ALERT_ACKNOWLEDGED = 'alert.acknowledged',
    ALERT_RESOLVED = 'alert.resolved',
}

// ─── Alert Types & Severity ──────────────────────────────────────────────────
export enum AlertType {
    OVERDUE_TASK = 'OVERDUE_TASK',
    BLOCKED_TASK = 'BLOCKED_TASK',
    MISSED_CHECK_IN = 'MISSED_CHECK_IN',
    UPCOMING_DEADLINE = 'UPCOMING_DEADLINE',
    UNASSIGNED_CRITICAL_TASK = 'UNASSIGNED_CRITICAL_TASK',
    TASK_AWAITING_REVIEW = 'TASK_AWAITING_REVIEW',
    PROJECT_AT_RISK = 'PROJECT_AT_RISK',
}

export enum AlertSeverity {
    INFO = 'INFO',
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    WARNING = 'WARNING',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum AlertStatus {
    ACTIVE = 'ACTIVE',
    ACKNOWLEDGED = 'ACKNOWLEDGED',
    RESOLVED = 'RESOLVED',
    DISMISSED = 'DISMISSED',
}

// ─── Socket Event Names (Versioned Envelope) ─────────────────────────────────
export const MONITORING_SOCKET_EVENTS = {
    // Client -> Server
    SUBSCRIBE: 'monitoring:subscribe',
    UNSUBSCRIBE: 'monitoring:unsubscribe',
    EMPLOYEE_SUBSCRIBE: 'monitoring:employee:subscribe',
    EMPLOYEE_UNSUBSCRIBE: 'monitoring:employee:unsubscribe',
    RESUME: 'monitoring:resume',
    HEARTBEAT: 'monitoring:heartbeat',

    // Server -> Client
    CONNECTED: 'monitoring:connected',
    SNAPSHOT_READY: 'monitoring:snapshot:ready',
    EMPLOYEE_SNAPSHOT_READY: 'monitoring:employee:snapshot:ready',
    PRESENCE_UPDATED: 'monitoring:presence:updated',
    EMPLOYEE_UPDATED: 'monitoring:employee:updated',
    ACTIVITY_CREATED: 'monitoring:activity:created',
    PROJECT_UPDATED: 'monitoring:project:updated',
    ATTENDANCE_UPDATED: 'monitoring:attendance:updated',
    ALERT_CREATED: 'monitoring:alert:created',
    ALERT_UPDATED: 'monitoring:alert:updated',
    SYNC_REQUIRED: 'monitoring:sync:required',
    ERROR: 'monitoring:error',
} as const;

// ─── Versioned Real-time Event Envelope ──────────────────────────────────────
export interface IMonitoringEventEnvelope<T = any> {
    eventId: string;
    schemaVersion: number;
    type: string;
    companyId: string;
    occurredAt: string;
    sequence: number;
    data: T;
}

// ─── DTO Interfaces ──────────────────────────────────────────────────────────

export interface IEmployeePresenceRecord {
    employeeId: string;
    name: string;
    email: string;
    avatar?: string | null;
    designation?: string | null;
    department?: string | null;
    presenceStatus: PresenceStatus;
    workStatus: EmployeeWorkStatus;
    attendanceStatus?: string;
    checkInTime?: Date | string | null;
    checkOutTime?: Date | string | null;
    workDurationMinutes?: number;
    lastSeenAt: Date | string | null;
    lastHeartbeatAt?: Date | string | null;
    connectionCount?: number;

    // Current Work Context
    currentProject?: {
        id: string;
        name: string;
    } | null;
    currentTask?: {
        taskId?: string;
        id?: string;
        taskTitle?: string;
        title?: string;
        taskNumber?: string;
        taskStatus?: string;
        status?: string;
        projectId?: string;
        projectName?: string;
        progress?: number | null;
        priority?: string;
    } | null;

    // Attendance Context
    attendance?: {
        status: string;
        firstCheckIn?: Date | string | null;
        lastCheckOut?: Date | string | null;
        workedMinutes?: number;
        isOnBreak?: boolean;
    } | null;
}

export interface ILiveOverviewSummary {
    companyId: string;
    snapshotTimestamp: string;
    employees: {
        totalActive: number;
        online: number;
        offline: number;
        working: number;
        onBreak: number;
        inMeeting: number;
        onLeave: number;
    };
    presence?: {
        totalEmployees: number;
        onlineEmployees: number;
        offlineEmployees: number;
        workingEmployees: number;
        onBreakEmployees: number;
        inMeetingEmployees: number;
        onLeaveEmployees: number;
    };
    attendance: {
        checkedIn: number;
        notCheckedIn: number;
        lateArrivals: number;
        halfDay: number;
        currentlyOnBreak: number;
        onApprovedLeave: number;
    };
    projects: {
        activeProjects: number;
        tasksInProgress: number;
        completedTasks: number;
        blockedTasks: number;
        overdueTasks: number;
        atRiskProjectsCount: number;
    };
    alerts: {
        activeCount: number;
        recent?: any[];
        criticalCount?: number;
        warningCount?: number;
        infoCount?: number;
    };
    recentActivity: Array<{
        id: string;
        eventId: string;
        sequence: number;
        eventType: string;
        actor: {
            userId?: string;
            displayName: string;
            avatar?: string;
        };
        summary: string;
        occurredAt: string;
    }>;
}

export interface IProjectLiveMetrics {
    id?: string;
    projectId: string;
    name: string;
    code?: string | null;
    type?: string;
    priority?: string;
    status: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    completionPercentage: number;
    isAtRisk: boolean;
    riskReasons: string[];
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    overdueTasks: number;
    taskMetrics?: {
        total: number;
        completed: number;
        inProgress: number;
        blocked: number;
        overdue: number;
    };
    teamMemberCount?: number;
}

export interface IAttendanceSnapshotRecord {
    employeeId: string;
    name?: string;
    employeeName?: string;
    email?: string;
    avatar?: string | null;
    designation?: string | null;
    department?: string | null;
    date?: string;
    status: string;
    punchStatus?: string;
    checkInTime?: Date | string | null;
    checkOutTime?: Date | string | null;
    firstCheckIn?: Date | string | null;
    lastCheckOut?: Date | string | null;
    workDurationMinutes?: number;
    workedMinutes?: number;
    isLate?: boolean;
    lateDurationMinutes?: number;
    breakDurationMinutes?: number;
    isOnBreak?: boolean;
    shift?: {
        id: string;
        name: string;
        startTime?: string;
        endTime?: string;
    } | null;
}

export interface IMonitoringAlertDto {
    id: string;
    companyId: string;
    alertType: AlertType;
    severity: AlertSeverity;
    title: string;
    summary: string;
    resourceType?: 'TASK' | 'PROJECT' | 'EMPLOYEE' | 'ATTENDANCE';
    resourceId?: string;
    status: AlertStatus;
    acknowledgedBy?: {
        id: string;
        name: string;
    } | null;
    acknowledgedAt?: Date | string | null;
    resolvedBy?: {
        id: string;
        name: string;
    } | null;
    resolvedAt?: Date | string | null;
    createdAt: Date | string;
    metadata?: Record<string, any>;
}
