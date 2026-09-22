import { DashboardQueryDto } from '../dashboard.types';

export interface CacheKeyContext {
    companyId: string;
    userId: string;
    hasLiveMonitoring: boolean;
    hasUserReview: boolean;
    query: DashboardQueryDto;
}

export class DashboardCacheKey {
    public static build(ctx: CacheKeyContext): string {
        const { companyId, userId, hasLiveMonitoring, hasUserReview, query } = ctx;
        const period = query.period || 'today';
        const start = query.startDate || '';
        const end = query.endDate || '';
        const project = query.projectId || '';
        const team = query.teamId || '';
        const tz = query.timezone || '';

        return `ws:dash:${companyId}:u:${userId}:perm:${hasLiveMonitoring ? 1 : 0}_${hasUserReview ? 1 : 0}:p:${period}:${start}_${end}:prj:${project}:tm:${team}:tz:${tz}`;
    }
}
