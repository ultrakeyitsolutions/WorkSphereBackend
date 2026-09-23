export interface ProjectStatisticsData {
    projectId: string;
    tasks: {
        total: number;
        completed: number;
        inProgress: number;
        notStarted: number;
    };
    bugs: {
        total: number;
        open: number;
        resolved: number;
    };
    team: {
        totalMembers: number;
        inChargeCount: number;
    };
    timeTracking: {
        totalWorkedHours: number;
    };
}
