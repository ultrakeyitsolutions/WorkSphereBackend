import { Types } from 'mongoose';

export type DashboardPeriod =
    | 'today'
    | 'week'
    | 'this_week'
    | 'last_7_days'
    | 'last_30_days'
    | 'month'
    | 'this_month'
    | 'last_month'
    | 'last_3_months'
    | 'custom';
export type DashboardScopeType = 'COMPANY' | 'SELF' | 'PROJECTS' | 'TEAM';

export interface DashboardQueryDto {
    period?: DashboardPeriod;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    teamId?: string;
    timezone?: string;
    companyId?: string; // For Super Admin impersonation
}

export interface ResolvedDateRange {
    period: string;
    startDateStr: string;
    endDateStr: string;
    startDate: Date;
    endDate: Date;
    timezone: string;
    days: string[];
    previousStartDate?: Date;
    previousEndDate?: Date;
    previousStartDateStr?: string;
    previousEndDateStr?: string;
}

export interface DashboardScopeContext {
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    roleName: string;
    scopeType: DashboardScopeType;
    isCompanyWide: boolean;
    accessibleProjectIds: Types.ObjectId[];
    hasLiveMonitoring: boolean;
    hasUserReview: boolean;
    dateRange: ResolvedDateRange;
    filterProjectId?: Types.ObjectId;
    filterTeamId?: Types.ObjectId;
}

export interface DashboardMeta {
    period: string;
    startDate: string;
    endDate: string;
    timezone: string;
    generatedAt: string;
    scope: DashboardScopeType;
    isCompanyWide: boolean;
}

export interface DashboardSummary {
    // Company-wide / Employee unified metrics
    totalEmployees?: number;
    activeEmployees?: number;
    workingNow?: number;
    idleNow?: number;
    onBreak?: number;
    inMeetings?: number;
    activeProjects?: number;
    totalTasks?: number;
    completedTasks?: number;
    inProgressTasks?: number;
    pendingTasks?: number;
    overdueTasks?: number;
    todayWorkingMinutes?: number;
    averageWorkingMinutes?: number;
    meetingsToday?: number;

    // Personal / Employee specific aliases
    myProjects?: number;
    myActiveProjects?: number;
    myTasks?: number;
    myCompletedTasks?: number;
    myPendingTasks?: number;
    myOverdueTasks?: number;
    myWorkingMinutes?: number;
    myActiveMinutes?: number;
    myBreakMinutes?: number;
    myIdleMinutes?: number;
    myMeetings?: number;
}

export interface ProjectAnalyticsItem {
    projectId: string;
    projectName: string;
    status: string;
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    overdueTasks: number;
    progressPercentage: number;
    memberCount?: number;
    loggedMinutes: number;

    // Employee specific
    myTasks?: number;
    myCompletedTasks?: number;
    myPendingTasks?: number;
    myOverdueTasks?: number;
    myLoggedMinutes?: number;
    myProgressPercentage?: number;
}

export interface ProductionByProjectItem {
    projectId: string;
    projectName: string;
    completedTasks: number;
    loggedMinutes: number;
    activeUsers: number;
    completionPercentage: number;
    taskActivityCount?: number;
}

export type LiveUserStatus = 'working' | 'idle' | 'break' | 'meeting' | 'offline';

export interface LiveMonitoringUser {
    userId: string;
    name: string;
    avatar: string | null;
    status: LiveUserStatus;
    project: string | null;
    task: string | null;
    durationMinutes: number;
    lastActivityAt: string | null;
}

export interface LiveMonitoringSummary {
    working: number;
    idle: number;
    break: number;
    meeting: number;
    offline: number;
}

export interface LiveMonitoringResponse {
    enabled: boolean;
    summary?: LiveMonitoringSummary;
    users?: LiveMonitoringUser[];
    self?: {
        userId: string;
        status: LiveUserStatus;
        durationMinutes: number;
        lastActivityAt: string | null;
    };
}

export interface TaskTrendItem {
    date: string;
    created: number;
    completed: number;
}

export interface TaskAnalyticsResponse {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    overdue: number;
    onHold: number;
    completionPercentage: number;
    trend: TaskTrendItem[];
}

export interface EmployeeProductivityItem {
    userId: string;
    name: string;
    avatar?: string | null;
    workingMinutes: number;
    activeMinutes: number;
    idleMinutes: number;
    breakMinutes?: number;
    completedTasks: number;
    productivityScore?: number | null;
}

export interface EmployeeProductivityResponse {
    enabled: boolean;
    summary: {
        averageWorkingMinutes: number;
        averageActiveMinutes: number;
        averageIdleMinutes: number;
        averageBreakMinutes: number;
    };
    employees: EmployeeProductivityItem[];
}

export interface TimesheetProjectBreakdown {
    projectId: string;
    projectName: string;
    loggedMinutes: number;
}

export interface TimesheetAnalyticsResponse {
    totalWorkingMinutes: number;
    totalActiveMinutes: number;
    totalIdleMinutes: number;
    totalBreakMinutes: number;
    overtimeMinutes: number;
    byProject: TimesheetProjectBreakdown[];
}

export interface AttendanceAnalyticsResponse {
    present: number;
    absent: number;
    onLeave: number;
    late: number;
    attendancePercentage: number;
}

export interface MeetingItem {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    meetingType: string;
    provider: string;
    meetingUrl: string | null;
    organizerName: string;
    participantCount: number;
}

export interface MeetingsAnalyticsResponse {
    today: number;
    upcoming: number;
    started: number;
    completed: number;
    cancelled: number;
    totalMinutes: number;
    items: MeetingItem[];
}

export interface SprintAnalyticsItem {
    sprintId: string;
    name: string;
    projectId: string;
    projectName: string;
    totalTasks: number;
    completedTasks: number;
    progressPercentage: number;
    startDate: string;
    endDate: string;
    daysRemaining: number;
}

export type ProjectHealthStatus = 'on_track' | 'at_risk' | 'delayed';

export interface ProjectHealthItem {
    projectId: string;
    projectName: string;
    status: ProjectHealthStatus;
    reasons: string[];
    myProgressPercentage?: number;
    myOverdueTasks?: number;
}

export interface RecentActivityItem {
    type: string;
    userId: string;
    userName: string;
    message: string;
    entityId: string;
    timestamp: string;
}

export interface AlertItem {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    count: number;
    message: string;
    entityType: 'task' | 'project' | 'attendance' | 'system';
    details?: any;
}

export interface DashboardData {
    meta: DashboardMeta;
    summary: DashboardSummary;
    projectAnalytics: ProjectAnalyticsItem[];
    productionByProject: ProductionByProjectItem[];
    monitoring: LiveMonitoringResponse;
    taskAnalytics: TaskAnalyticsResponse;
    employeeProductivity: EmployeeProductivityResponse;
    timesheetAnalytics: TimesheetAnalyticsResponse;
    attendanceAnalytics: AttendanceAnalyticsResponse;
    meetings: MeetingsAnalyticsResponse;
    sprints: SprintAnalyticsItem[];
    projectHealth: ProjectHealthItem[];
    recentActivity: RecentActivityItem[];
    alerts: AlertItem[];
}

export interface DashboardResponse {
    success: boolean;
    message?: string;
    data: DashboardData;
}

// ─── Company Admin Redesigned Dashboard Contracts ───────────────────────────

export interface MetricComparison {
    current: number;
    previous: number;
    percentageChange: number | null;
    trend: 'UP' | 'DOWN' | 'FLAT';
}

export interface CompanyDashboardOverviewData {
    meta: DashboardMeta;
    projects: {
        active: number;
        completed: number;
        total: number;
        deliveryRate: number;
    };
    tasks: {
        total: number;
        completed: number;
        open: number;
        overdue: number;
    };
    periodMetrics: {
        completedTasks: number;
        createdTasks: number;
        completionRate: number | null;
        trackedHours: number;
        attendanceHours: number;
    };
    comparisons: {
        completedTasks: MetricComparison;
        createdTasks: MetricComparison;
        trackedHours: MetricComparison;
    };
}

export interface DeliveryTrendBucket {
    date: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    plannedTasks: number;
    completedTasks: number;
    completionRate: number | null;
}

export interface CompanyDeliveryTrendsData {
    meta: DashboardMeta & { interval: 'day' | 'week' | 'month' };
    summary: {
        totalPlanned: number;
        totalCompleted: number;
        overallCompletionRate: number | null;
    };
    buckets: DeliveryTrendBucket[];
}

export interface ProjectHealthCardItem {
    projectId: string;
    projectName: string;
    status: string;
    healthStatus: ProjectHealthStatus;
    progressPercentage: number;
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
    startDate: string;
    endDate: string;
    reasons: string[];
}

export interface CompanyProjectHealthData {
    meta: {
        generatedAt: string;
        timezone: string;
    };
    summary: {
        totalEvaluated: number;
        onTrack: { count: number; percentage: number };
        atRisk: { count: number; percentage: number };
        delayed: { count: number; percentage: number };
    };
    projects: ProjectHealthCardItem[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface MemberWorkloadItem {
    userId: string;
    name: string;
    email: string;
    designation: string;
    memberType: string;
    assignedTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
    trackedHours: number;
    workloadStatus: 'under_capacity' | 'balanced' | 'overloaded';
}

export interface CompanyWorkloadData {
    meta: DashboardMeta;
    summary: {
        totalMembers: number;
        underCapacity: number;
        balanced: number;
        overloaded: number;
    };
    members: MemberWorkloadItem[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface AttentionTaskItem {
    id: string;
    title: string;
    taskNumber?: string;
    projectId: string;
    projectName: string;
    assignedTo: { id: string; name: string } | null;
    dueDate: string;
    daysOverdue?: number;
    priority: string;
}

export interface AttentionProjectItem {
    id: string;
    name: string;
    healthStatus: 'delayed' | 'at_risk';
    progressPercentage: number;
    endDate: string;
    reasons: string[];
}

export interface AttentionLeaveItem {
    id: string;
    employeeId: string;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    reason: string;
    appliedAt: string;
}

export interface AttentionTimesheetItem {
    id: string;
    userId: string;
    userName: string;
    periodStart: string;
    periodEnd: string;
    submittedAt?: string;
}

export interface CompanyAttentionData {
    meta: {
        generatedAt: string;
        timezone: string;
    };
    counts: {
        overdueTasks: number;
        upcomingDeadlines: number;
        atRiskProjects: number;
        pendingLeaves: number;
        pendingTimesheets: number;
    };
    overdueTasks: AttentionTaskItem[];
    upcomingDeadlines: AttentionTaskItem[];
    atRiskProjects: AttentionProjectItem[];
    pendingLeaves: AttentionLeaveItem[];
    pendingTimesheets: AttentionTimesheetItem[];
}

export interface MilestoneCardItem {
    id: string;
    name: string;
    version?: string;
    type: 'RELEASE' | 'PROJECT_END';
    projectId: string;
    projectName: string;
    targetDate: string;
    status: string;
    progressPercentage: number;
    totalTasks: number;
    completedTasks: number;
    daysRemaining: number;
    isOverdue: boolean;
}

export interface CompanyMilestonesData {
    meta: {
        generatedAt: string;
        timezone: string;
    };
    summary: {
        total: number;
        upcoming: number;
        completed: number;
        overdue: number;
    };
    milestones: MilestoneCardItem[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// ─── Member Redesigned Dashboard Contracts ───────────────────────────────────

export interface MemberDashboardOverviewData {
    meta: DashboardMeta;
    projects: {
        assignedTotal: number;
    };
    tasks: {
        total: number;
        completed: number;
        open: number;
        overdue: number;
        completionRate: number;
    };
    periodMetrics: {
        tasksCompleted: number;
        tasksCreatedOrAssigned: number;
        trackedHours: number;
        attendanceDays: number;
    };
    todayAttendance: {
        isCheckedIn: boolean;
        checkInTime: string | null;
        status: string | null;
    };
    pendingLeaves: number;
    latestTimesheet: {
        periodStart: string | null;
        periodEnd: string | null;
        status: string | null;
    } | null;
}

export interface MemberTrendBucket {
    date: string;
    label: string;
    tasksCompleted: number;
    tasksAssigned: number;
    trackedHours: number;
}

export interface MemberWorkTrendsData {
    meta: DashboardMeta & { interval: 'day' | 'week' };
    summary: {
        totalTasksCompleted: number;
        totalTrackedHours: number;
    };
    buckets: MemberTrendBucket[];
}

export interface MemberTaskItem {
    id: string;
    title: string;
    taskNumber?: string;
    projectId: string;
    projectName: string;
    priority: string;
    status?: string;
    dueDate?: string | null;
    progress?: number;
}

export interface MemberProjectSummary {
    id: string;
    name: string;
    status: string;
    priority: string;
    totalTasks: number;
    completedTasks: number;
    myTasks: number;
    myCompletedTasks: number;
    progressPercentage: number;
}

export interface MemberMyWorkData {
    meta: {
        generatedAt: string;
        timezone: string;
    };
    summary: {
        inProgressCount: number;
        overdueCount: number;
        upcomingCount: number;
        projectsCount: number;
    };
    inProgressTasks: MemberTaskItem[];
    overdueTasks: MemberTaskItem[];
    upcomingTasks: MemberTaskItem[];
    myProjects: MemberProjectSummary[];
}

