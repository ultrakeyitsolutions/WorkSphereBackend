
export type PerformanceRangePreset =
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'last_week'
    | 'this_month'
    | 'last_month'
    | 'custom';

export interface DateRangeQuery {
    range?: PerformanceRangePreset;
    from?: string;
    to?: string;
    timezone?: string;
}

export interface PerformancePeriod {
    range: PerformanceRangePreset;
    from: Date;
    to: Date;
    timezone: string;
}

export interface UserSummaryDto {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    role: string;
    designation: string | null;
    joinDate?: Date;
}

export interface AttendanceMetricsDto {
    totalDaysInRange: number;
    checkedInDays: number;
    totalCheckedInMinutes: number;
    averageCheckedInMinutesPerDay: number;
}

export interface TimeTrackingMetricsDto {
    totalTrackedMinutes: number;
    workMinutes: number;
    breakMinutes: number;
    holdMinutes: number;
    netProductiveMinutes: number;
    avgDailyTrackedMinutes: number;
}

export interface TaskMetricsDto {
    totalAssigned: number;
    completed: number;
    inProgress: number;
    pending: number;
    overdue: number;
    completionRatePercentage: number;
}

export interface ProjectMetricsDto {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
}

export interface MeetingMetricsDto {
    totalMeetings: number;
    totalMeetingMinutes: number;
    organizedCount: number;
    attendedCount: number;
}

export interface ProductivityScoreDto {
    score: number; // 0 to 100
    rating: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'NEEDS_IMPROVEMENT';
    breakdown: {
        productionScore: number;  // 40% weight
        taskScore: number;        // 30% weight
        attendanceScore: number;  // 15% weight
        focusScore: number;       // 15% weight
    };
}

export interface TimelineEventDto {
    timestamp: Date;
    type: 'ATTENDANCE' | 'TRACKING' | 'TASK_ACTIVITY' | 'MEETING';
    title: string;
    description: string;
    category: string;
    metadata?: Record<string, any>;
}

export interface DailyTrendItemDto {
    date: string; // YYYY-MM-DD
    checkedInMinutes: number;
    trackedMinutes: number;
    completedTasksCount: number;
    meetingsCount: number;
}

export interface PerformanceSummaryResponse {
    user: UserSummaryDto;
    period: {
        range: string;
        from: string;
        to: string;
        timezone: string;
    };
    productivity: ProductivityScoreDto;
    attendance: AttendanceMetricsDto;
    timeTracking: TimeTrackingMetricsDto;
    tasks: TaskMetricsDto;
    projects: ProjectMetricsDto;
    meetings: MeetingMetricsDto;
}

export interface PerformanceTimelineResponse {
    user: { id: string; name: string };
    period: { from: string; to: string };
    timeline: TimelineEventDto[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface PerformanceTasksResponse {
    user: { id: string; name: string };
    metrics: TaskMetricsDto;
    tasks: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface PerformanceMeetingsResponse {
    user: { id: string; name: string };
    metrics: MeetingMetricsDto;
    meetings: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface PerformanceDailyResponse {
    user: { id: string; name: string };
    period: { from: string; to: string };
    dailyTrends: DailyTrendItemDto[];
}
