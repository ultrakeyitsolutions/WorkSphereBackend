import {
    PresenceStatus,
    EmployeeWorkStatus,
    IMonitoringAlertDto,
} from '../live-monitoring/live-monitoring.types';

// ─── Date Range Filter Types ─────────────────────────────────────────────────
export type DetailedDateRangePreset =
    | 'TODAY'
    | 'YESTERDAY'
    | 'LAST_7_DAYS'
    | 'LAST_30_DAYS'
    | 'THIS_MONTH'
    | 'LAST_3_MONTHS'
    | 'CUSTOM';

// ─── Directory Item DTO ──────────────────────────────────────────────────────
export interface IDetailedEmployeeDirectoryItem {
    employeeId: string;
    userId: string;
    name: string;
    email: string;
    avatar?: string | null;
    employeeCode?: string | null;
    designationId?: string | null;
    designationName?: string | null;
    department?: string | null;
    roleId?: string | null;
    roleName?: string | null;
    manager?: {
        id: string;
        name: string;
        email?: string;
        avatar?: string | null;
    } | null;
    presenceStatus: PresenceStatus;
    workStatus: EmployeeWorkStatus;
    attendanceStatus: string;
    currentProject?: {
        id: string;
        name: string;
    } | null;
    currentTask?: {
        id?: string;
        taskId?: string;
        title?: string;
        taskTitle?: string;
        taskNumber?: string;
        status?: string;
        taskStatus?: string;
        priority?: string;
        progress?: number | null;
    } | null;
    lastActivityTime?: string | Date | null;
    unresolvedAlertsCount: number;
    joinedAt?: string | Date | null;
    status: string;
}

// ─── Individual Employee Profile Header DTO ──────────────────────────────────
export interface IDetailedEmployeeProfile {
    employeeId: string;
    userId: string;
    name: string;
    email: string;
    avatar?: string | null;
    phone?: string | null;
    employeeCode?: string | null;
    designation?: {
        id: string;
        name: string;
        department?: string | null;
    } | null;
    department?: string | null;
    role?: {
        id: string;
        name: string;
    } | null;
    memberType: string;
    employmentStatus: string;
    joinedAt: string | Date | null;
    biometricId?: string | null;
    manager?: {
        id: string;
        name: string;
        email?: string;
        avatar?: string | null;
    } | null;

    // Independent Status Dimensions
    presenceStatus: PresenceStatus;
    attendanceStatus: string;
    workStatus: EmployeeWorkStatus;
    isOnline: boolean;
    isCheckedIn: boolean;
    isOnBreak: boolean;
    isInMeeting: boolean;
    isOnLeave: boolean;

    // Current Work Context
    currentProject?: {
        id: string;
        name: string;
    } | null;
    currentTask?: {
        id?: string;
        taskId?: string;
        title?: string;
        taskTitle?: string;
        taskNumber?: string;
        status?: string;
        taskStatus?: string;
        priority?: string;
        progress?: number | null;
    } | null;

    // Timestamps & Metrics
    lastSeenAt?: string | Date | null;
    lastHeartbeatAt?: string | Date | null;
    todayWorkMinutes: number;
    todayBreakMinutes: number;
    unresolvedAlertsCount: number;
}

// ─── Employee Overview Summary DTO ───────────────────────────────────────────
export interface IDetailedEmployeeOverview {
    employeeId: string;
    dateRange: {
        preset: DetailedDateRangePreset;
        startDate: string;
        endDate: string;
    };
    metrics: {
        activeAssignedProjectsCount: number;
        totalOpenTasksCount: number;
        tasksInProgressCount: number;
        completedTasksCount: number; // in selected period
        overdueTasksCount: number;
        blockedTasksCount: number;
        tasksAwaitingReviewCount: number;
        todayWorkingDurationMinutes: number;
        todayBreakDurationMinutes: number;
        periodWorkingDurationMinutes: number;
        periodBreakDurationMinutes: number;
        meetingsAttendedCount: number;
        unresolvedAlertsCount: number;
        productivityScore: number; // 0-100 calculated metric
    };
    attendanceSummary: {
        totalDays: number;
        presentDays: number;
        absentDays: number;
        lateDays: number;
        halfDays: number;
        leaveDays: number;
        holidayDays: number;
    };
    recentActivities: Array<{
        id: string;
        eventType: string;
        summary: string;
        occurredAt: string;
        projectName?: string;
        taskTitle?: string;
    }>;
    activeAlerts: IMonitoringAlertDto[];
}

// ─── Attendance & Time-Tracking History DTOs ─────────────────────────────────
export interface IAttendanceBreakRecord {
    startTime: string | Date;
    endTime?: string | Date | null;
    durationMinutes: number;
    reason?: string | null;
}

export interface IWorkSessionRecord {
    sessionId?: string;
    startTime: string | Date;
    endTime?: string | Date | null;
    durationMinutes: number;
    taskId?: string;
    taskTitle?: string;
    taskNumber?: string;
    projectId?: string;
    projectName?: string;
}

export interface IAttendanceAdjustmentSummary {
    adjustmentId: string;
    date: string;
    status: string;
    reason: string;
    requestedValues: {
        status?: string;
        firstCheckIn?: Date | string | null;
        lastCheckOut?: Date | string | null;
        workedMinutes?: number;
    };
    approvedBy?: {
        id: string;
        name: string;
    } | null;
    approvedAt?: Date | string | null;
    rejectionReason?: string | null;
}

export interface IDetailedAttendanceDayRecord {
    date: string; // YYYY-MM-DD
    status: string;
    punchStatus: string;
    checkInTime?: string | Date | null;
    checkOutTime?: string | Date | null;
    scheduled: {
        startTime?: string | Date | null;
        endTime?: string | Date | null;
        workingMinutes: number;
    };
    actual: {
        firstCheckIn?: string | Date | null;
        lastCheckOut?: string | Date | null;
        workedMinutes: number;
    };
    metrics: {
        lateMinutes: number;
        earlyLeaveMinutes: number;
        overtimeMinutes: number;
    };
    breakDurationMinutes: number;
    breaks: IAttendanceBreakRecord[];
    workSessions: IWorkSessionRecord[];
    isLate: boolean;
    isEarlyLeave: boolean;
    isOvertime: boolean;
    isMissingCheckOut: boolean;
    shift?: {
        id: string;
        name: string;
        startTime?: string;
        endTime?: string;
    } | null;
    leave?: {
        leaveId: string;
        leaveType: string;
        durationType: string;
    } | null;
    holiday?: {
        holidayId: string;
        holidayName: string;
    } | null;
    adjustments: IAttendanceAdjustmentSummary[];
}

export interface IDetailedAttendanceHistoryResponse {
    records: IDetailedAttendanceDayRecord[];
    summary: {
        totalScheduledHours: number;
        totalWorkedHours: number;
        totalBreakHours: number;
        totalOvertimeHours: number;
        totalLateMinutes: number;
        presentDays: number;
        absentDays: number;
        lateDays: number;
        halfDays: number;
        leaveDays: number;
        holidayDays: number;
        missingCheckoutsCount: number;
        averageDailyWorkedHours: number;
    };
    total: number;
    page: number;
    limit: number;
}

// ─── Assigned Projects DTO ───────────────────────────────────────────────────
export interface IDetailedEmployeeProjectItem {
    projectId: string;
    name: string;
    description?: string | null;
    type: string;
    priority: string;
    status: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    actualEndDate?: string | Date | null;
    manager?: {
        id: string;
        name: string;
        email?: string;
        avatar?: string | null;
    } | null;
    employeeRole: 'IN_CHARGE' | 'TEAM_MEMBER' | 'LEAD';
    assignedDate?: string | Date | null;
    recordedProgress: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    overdueTasks: number;
    trackedTimeSeconds: number;
    estimatedHours: number;
    recentActivity?: Array<{
        summary: string;
        occurredAt: string;
    }>;
}

// ─── Assigned Tasks & Task History DTO ───────────────────────────────────────
export interface IDetailedEmployeeTaskItem {
    taskId: string;
    taskNumber?: string;
    itemNumber?: number;
    title: string;
    notes?: string[];
    project: {
        id: string;
        name: string;
    };
    sprint?: {
        id: string;
        name: string;
    } | null;
    release?: {
        id: string;
        name: string;
    } | null;
    priority: string;
    status: string;
    statusColor?: string;
    stage?: string | null;
    criticality: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    dueDate?: string | Date | null;
    deliveryDate?: string | Date | null;
    completedDate?: string | Date | null;
    isOverdue: boolean;
    progress: number;
    estimatedTime: {
        hours: number;
        minutes: number;
    };
    actualHours: number;
    actualTrackedSeconds: number;
    isBlocked: boolean;
    blockerReason?: string | null;
    reviewStatus: string;
    commentsCount: number;
    attachmentsCount: number;
    checklistProgress: {
        total: number;
        completed: number;
    };
    reopenHistory?: {
        isReopen: boolean;
        reopenedFromTaskNumber?: string | null;
        reopenReason?: string | null;
    } | null;
    activityTimeline?: Array<{
        type: string;
        content?: string;
        createdAt: string;
        userName?: string;
    }>;
}

// ─── Meeting Participation DTO ──────────────────────────────────────────────
export interface IDetailedMeetingItem {
    meetingId: string;
    title: string;
    agenda: string;
    description?: string | null;
    meetingType: string;
    meetingLink?: string | null;
    organizer: {
        id: string;
        name: string;
        avatar?: string | null;
    };
    project?: {
        id: string;
        name: string;
    } | null;
    task?: {
        id: string;
        title: string;
    } | null;
    scheduledStartAt: string | Date;
    scheduledEndAt: string | Date;
    durationMinutes: number;
    actualStartAt?: string | Date | null;
    actualEndAt?: string | Date | null;
    invitationStatus: string;
    participation: {
        joinedAt?: string | Date | null;
        leftAt?: string | Date | null;
        durationMinutes: number;
        didAttend: boolean;
        rescheduleReason?: string | null;
        declineReason?: string | null;
    };
    status: string;
}

// ─── Timeline Entry DTO ──────────────────────────────────────────────────────
export interface IDetailedTimelineEntry {
    id: string;
    eventId: string;
    sequence?: number;
    eventType: string;
    source: 'MONITORING_ACTIVITY' | 'TASK_ACTIVITY' | 'ATTENDANCE_EVENT' | 'TIME_TRACKING' | 'MEETING';
    actor: {
        userId?: string;
        displayName: string;
        avatar?: string;
    };
    summary: string;
    description?: string;
    occurredAt: string;
    project?: {
        id: string;
        name: string;
    } | null;
    task?: {
        id: string;
        title: string;
    } | null;
    meeting?: {
        id: string;
        title: string;
    } | null;
    metadata?: Record<string, any>;
}

// ─── Workload and Productivity Analytics DTO ────────────────────────────────
export interface IDetailedEmployeeAnalytics {
    employeeId: string;
    dateRange: {
        preset: DetailedDateRangePreset;
        startDate: string;
        endDate: string;
    };
    taskMetrics: {
        assigned: number;
        completed: number;
        inProgress: number;
        overdue: number;
        blocked: number;
        awaitingReview: number;
        completionRate: number; // percentage
        onTimeCompletionRate: number; // percentage
    };
    dailyTrends: Array<{
        date: string;
        tasksCompleted: number;
        tasksAssigned: number;
        trackedMinutes: number;
        breakMinutes: number;
        meetingMinutes: number;
    }>;
    projectWorkload: Array<{
        projectId: string;
        projectName: string;
        tasksCount: number;
        completedTasksCount: number;
        trackedMinutes: number;
        percentageOfTotalTime: number;
    }>;
    durationComparison: {
        estimatedHoursTotal: number;
        actualHoursTrackedTotal: number;
        varianceHours: number; // actual - estimated
    };
    attendanceMetrics: {
        totalDays: number;
        presentDays: number;
        absentDays: number;
        lateDays: number;
        halfDays: number;
        leaveDays: number;
        averageWorkHoursPerDay: number;
        totalOvertimeHours: number;
    };
    meetingMetrics: {
        totalScheduled: number;
        totalAttended: number;
        totalDurationMinutes: number;
        attendanceRate: number; // percentage
    };
}

// ─── Report Export Type ──────────────────────────────────────────────────────
export type DetailedReportType =
    | 'ATTENDANCE'
    | 'TIME_TRACKING'
    | 'PROJECTS'
    | 'TASKS'
    | 'MEETINGS'
    | 'ACTIVITY'
    | 'WORKLOAD_SUMMARY';
