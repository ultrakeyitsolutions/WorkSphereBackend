import { Types } from 'mongoose';

export type DashboardPeriod = 'today' | 'week' | 'month' | 'last_month' | 'custom';
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
