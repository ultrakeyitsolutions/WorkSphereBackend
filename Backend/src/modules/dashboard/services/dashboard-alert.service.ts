import { AlertItem, ProjectHealthItem } from '../dashboard.types';

export interface AlertEvaluationContext {
    isCompanyWide: boolean;
    overdueTaskCount: number;
    projectHealthList: ProjectHealthItem[];
    attendancePercentage: number;
    unresolvedBlockersCount: number;
    upcomingDeadlinesCount?: number;
}

export class DashboardAlertService {
    public static generateAlerts(ctx: AlertEvaluationContext): AlertItem[] {
        const alerts: AlertItem[] = [];

        // 1. Overdue Tasks Alert
        if (ctx.overdueTaskCount > 0) {
            alerts.push({
                type: 'OVERDUE_TASKS',
                severity: ctx.overdueTaskCount >= 8 ? 'critical' : 'high',
                count: ctx.overdueTaskCount,
                message: ctx.isCompanyWide
                    ? `${ctx.overdueTaskCount} task${ctx.overdueTaskCount > 1 ? 's are' : ' is'} overdue across the company`
                    : `You have ${ctx.overdueTaskCount} overdue task${ctx.overdueTaskCount > 1 ? 's' : ''}`,
                entityType: 'task',
            });
        }

        // 2. Delayed Projects Alert
        const delayedProjects = ctx.projectHealthList.filter((p) => p.status === 'delayed');
        if (delayedProjects.length > 0) {
            alerts.push({
                type: 'PROJECT_DELAYED',
                severity: 'critical',
                count: delayedProjects.length,
                message: `${delayedProjects.length} project${delayedProjects.length > 1 ? 's are' : ' is'} delayed`,
                entityType: 'project',
                details: delayedProjects.map((p) => ({ id: p.projectId, name: p.projectName })),
            });
        }

        // 3. At Risk Projects Alert
        const atRiskProjects = ctx.projectHealthList.filter((p) => p.status === 'at_risk');
        if (atRiskProjects.length > 0) {
            alerts.push({
                type: 'PROJECT_AT_RISK',
                severity: 'high',
                count: atRiskProjects.length,
                message: `${atRiskProjects.length} project${atRiskProjects.length > 1 ? 's are' : ' is'} at risk`,
                entityType: 'project',
                details: atRiskProjects.map((p) => ({ id: p.projectId, name: p.projectName })),
            });
        }

        // 4. Low Attendance Alert (Only for company-wide scope)
        if (ctx.isCompanyWide && ctx.attendancePercentage > 0 && ctx.attendancePercentage < 75) {
            alerts.push({
                type: 'LOW_ATTENDANCE',
                severity: 'medium',
                count: 1,
                message: `Today's attendance is at ${Math.round(ctx.attendancePercentage)}% (below target threshold of 75%)`,
                entityType: 'attendance',
            });
        }

        // 5. Unresolved Blockers Alert
        if (ctx.unresolvedBlockersCount > 0) {
            alerts.push({
                type: 'UNRESOLVED_BLOCKER',
                severity: 'medium',
                count: ctx.unresolvedBlockersCount,
                message: `${ctx.unresolvedBlockersCount} unresolved doubt/blocker${ctx.unresolvedBlockersCount > 1 ? 's require' : ' requires'} attention`,
                entityType: 'task',
            });
        }

        return alerts;
    }
}
