export interface TimeSeriesPoint {
    date: string;
    count: number;
}

export interface GrowthAnalyticsData {
    range: string;
    total: number;
    points: TimeSeriesPoint[];
}

export interface ProjectsAnalyticsSummary {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
}

export interface WorkforceAnalyticsData {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    activeCheckIns: number;
    attendanceRate: number; // percentage active / total
    taskCompletionRate: number; // percentage completed / total
}

export interface PlatformUsageAnalyticsData {
    activeSessions: number;
    totalFiles: number;
    totalStorageBytes: number;
    totalMessages: number;
    totalCalls: number;
}
