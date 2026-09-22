import { DashboardScopeContext, DashboardSummary } from '../dashboard.types';

export interface SummaryAnalyticsInput {
    context: DashboardScopeContext;
    totalEmployees: number;
    activeEmployees: number;
    workingNow: number;
    idleNow: number;
    onBreak: number;
    inMeetings: number;
    activeProjects: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    pendingTasks: number;
    overdueTasks: number;
    totalWorkingMinutes: number;
    totalActiveMinutes: number;
    totalBreakMinutes: number;
    totalIdleMinutes: number;
    meetingsCount: number;
}

export class SummaryAnalytics {
    public static computeSummary(input: SummaryAnalyticsInput): DashboardSummary {
        const { context } = input;

        if (context.isCompanyWide) {
            const avgWorkingMinutes = input.activeEmployees > 0
                ? Math.round(input.totalWorkingMinutes / input.activeEmployees)
                : 0;

            return {
                totalEmployees: input.totalEmployees,
                activeEmployees: input.activeEmployees,
                workingNow: input.workingNow,
                idleNow: input.idleNow,
                onBreak: input.onBreak,
                inMeetings: input.inMeetings,
                activeProjects: input.activeProjects,
                totalTasks: input.totalTasks,
                completedTasks: input.completedTasks,
                inProgressTasks: input.inProgressTasks,
                pendingTasks: input.pendingTasks,
                overdueTasks: input.overdueTasks,
                todayWorkingMinutes: input.totalWorkingMinutes,
                averageWorkingMinutes: avgWorkingMinutes,
                meetingsToday: input.meetingsCount,
            };
        }

        // Employee / Personal Scope
        return {
            myProjects: context.accessibleProjectIds.length,
            myActiveProjects: input.activeProjects,
            myTasks: input.totalTasks,
            myCompletedTasks: input.completedTasks,
            myPendingTasks: input.pendingTasks,
            myOverdueTasks: input.overdueTasks,
            myWorkingMinutes: input.totalWorkingMinutes,
            myActiveMinutes: input.totalActiveMinutes,
            myBreakMinutes: input.totalBreakMinutes,
            myIdleMinutes: input.totalIdleMinutes,
            myMeetings: input.meetingsCount,
        };
    }
}
