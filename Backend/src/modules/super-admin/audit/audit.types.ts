export interface AuditLogFilters {
    search?: string;
    actorUserId?: string;
    targetUserId?: string;
    companyId?: string;
    action?: string;
    module?: string;
    startDate?: string;
    endDate?: string;
}
