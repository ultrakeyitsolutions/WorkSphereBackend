export interface OverviewSummaryData {
    companies: {
        total: number;
        active: number;
        new: number;
    };
    users: {
        total: number;
        active: number;
        new: number;
    };
    projects: {
        total: number;
        active: number;
        completed: number;
    };
    subscriptions: {
        active: number;
        trial: number;
        expired: number;
        cancelled: number;
    };
}
