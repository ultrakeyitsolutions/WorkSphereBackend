export interface UserStatisticsData {
    userId: string;
    projects: {
        total: number;
        created: number;
        assigned: number;
    };
    tasks: {
        total: number;
        completed: number;
        inProgress: number;
    };
    timesheet: {
        totalWorkedHours: number;
    };
    attendance: {
        totalRecords: number;
        checkedIn: boolean;
    };
}

export interface UserEffectivePermissionsData {
    userId: string;
    roleName: string;
    baseRolePermissions: string[];
    grantedPermissions: string[];
    revokedPermissions: string[];
    effectivePermissions: string[];
}
