export interface SecuritySummaryData {
    activeSessions: number;
    failedLogins: {
        last24Hours: number;
        last7Days: number;
    };
    mfaAdoption: {
        totalUsers: number;
        mfaEnabledUsers: number;
        adoptionRate: number; // percentage
    };
    securityEvents: {
        last24Hours: number;
        last7Days: number;
    };
}
