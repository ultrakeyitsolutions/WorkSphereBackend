import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { DashboardDateRangeService } from '../../src/modules/dashboard/services/dashboard-date-range.service';
import { ProjectHealthService } from '../../src/modules/dashboard/services/project-health.service';
import { DashboardAlertService } from '../../src/modules/dashboard/services/dashboard-alert.service';
import { SummaryAnalytics } from '../../src/modules/dashboard/analytics/summary.analytics';
import { DashboardCacheKey } from '../../src/modules/dashboard/utils/dashboard-cache-key';
import { DashboardScopeContext } from '../../src/modules/dashboard/dashboard.types';

describe('WorkSphere Centralized Role-Aware & Scope-Aware Dashboard Tests', () => {
    describe('1. DashboardDateRangeService - Timezone Resolution & Date Boundaries', () => {
        it('should fallback from query -> company -> user -> Asia/Kolkata', () => {
            expect(DashboardDateRangeService.resolveTimezone('America/Chicago', 'America/New_York', 'Europe/London')).toBe('America/Chicago');
            expect(DashboardDateRangeService.resolveTimezone(undefined, 'America/New_York', 'Europe/London')).toBe('America/New_York');
            expect(DashboardDateRangeService.resolveTimezone(undefined, null, 'Europe/London')).toBe('Europe/London');
            expect(DashboardDateRangeService.resolveTimezone(undefined, null, null)).toBe('Asia/Kolkata');
        });

        it('should calculate exact day boundaries for today', () => {
            const today = DashboardDateRangeService.resolve({ period: 'today' });
            expect(today.period).toBe('today');
            expect(today.startDate.getHours()).toBe(0);
            expect(today.startDate.getMinutes()).toBe(0);
            expect(today.endDate.getHours()).toBe(23);
            expect(today.endDate.getMinutes()).toBe(59);
            expect(today.days).toHaveLength(1);
        });

        it('should calculate exact day array for custom range', () => {
            const custom = DashboardDateRangeService.resolve({
                period: 'custom',
                startDate: '2026-09-01',
                endDate: '2026-09-04',
            });
            expect(custom.startDateStr).toBe('2026-09-01');
            expect(custom.endDateStr).toBe('2026-09-04');
            expect(custom.days).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
        });
    });

    describe('2. SummaryAnalytics - Role & Scope Resolution', () => {
        const companyId = new Types.ObjectId();
        const userId = new Types.ObjectId();
        const dateRange = DashboardDateRangeService.resolve({ period: 'today' });

        it('COMPANY_ADMIN: computes company-wide summary and omits employee personal fields', () => {
            const adminContext: DashboardScopeContext = {
                companyId,
                userId,
                roleName: 'COMPANY_ADMIN',
                scopeType: 'COMPANY',
                isCompanyWide: true,
                accessibleProjectIds: [new Types.ObjectId(), new Types.ObjectId()],
                hasLiveMonitoring: true,
                hasUserReview: true,
                dateRange,
            };

            const summary = SummaryAnalytics.computeSummary({
                context: adminContext,
                totalEmployees: 48,
                activeEmployees: 42,
                workingNow: 31,
                idleNow: 4,
                onBreak: 3,
                inMeetings: 4,
                activeProjects: 12,
                totalTasks: 248,
                completedTasks: 156,
                inProgressTasks: 54,
                pendingTasks: 27,
                overdueTasks: 11,
                totalWorkingMinutes: 11184,
                totalActiveMinutes: 8640,
                totalBreakMinutes: 1344,
                totalIdleMinutes: 1200,
                meetingsCount: 8,
            });

            expect(summary.totalEmployees).toBe(48);
            expect(summary.activeEmployees).toBe(42);
            expect(summary.workingNow).toBe(31);
            expect(summary.averageWorkingMinutes).toBe(Math.round(11184 / 42));
            expect(summary.completedTasks).toBe(156);
            expect(summary.myProjects).toBeUndefined();
            expect(summary.myTasks).toBeUndefined();
        });

        it('EMPLOYEE: computes personal summary and omits company-wide totals', () => {
            const p1 = new Types.ObjectId();
            const p2 = new Types.ObjectId();

            const employeeContext: DashboardScopeContext = {
                companyId,
                userId,
                roleName: 'EMPLOYEE',
                scopeType: 'PROJECTS',
                isCompanyWide: false,
                accessibleProjectIds: [p1, p2],
                hasLiveMonitoring: false,
                hasUserReview: false,
                dateRange,
            };

            const summary = SummaryAnalytics.computeSummary({
                context: employeeContext,
                totalEmployees: 0,
                activeEmployees: 0,
                workingNow: 0,
                idleNow: 0,
                onBreak: 0,
                inMeetings: 0,
                activeProjects: 2,
                totalTasks: 14,
                completedTasks: 8,
                inProgressTasks: 2,
                pendingTasks: 4,
                overdueTasks: 2,
                totalWorkingMinutes: 420,
                totalActiveMinutes: 350,
                totalBreakMinutes: 45,
                totalIdleMinutes: 25,
                meetingsCount: 3,
            });

            expect(summary.totalEmployees).toBeUndefined();
            expect(summary.workingNow).toBeUndefined();
            expect(summary.myProjects).toBe(2);
            expect(summary.myActiveProjects).toBe(2);
            expect(summary.myTasks).toBe(14);
            expect(summary.myCompletedTasks).toBe(8);
            expect(summary.myPendingTasks).toBe(4);
            expect(summary.myOverdueTasks).toBe(2);
            expect(summary.myWorkingMinutes).toBe(420);
            expect(summary.myActiveMinutes).toBe(350);
            expect(summary.myBreakMinutes).toBe(45);
            expect(summary.myIdleMinutes).toBe(25);
            expect(summary.myMeetings).toBe(3);
        });
    });

    describe('3. ProjectHealthService - Explainable Health Evaluation', () => {
        const now = new Date('2026-09-22T12:00:00.000Z');

        it('Company Admin: marks project delayed when deadline passed with incomplete tasks', () => {
            const result = ProjectHealthService.evaluate({
                projectId: 'p1',
                projectName: 'Phoenix Platform',
                endDate: new Date('2026-09-15T00:00:00.000Z'),
                totalTasks: 30,
                completedTasks: 10,
                overdueTasks: 5,
                progressPercentage: 33.3,
                unresolvedBlockers: 0,
            }, now);

            expect(result.status).toBe('delayed');
            expect(result.reasons.some((r) => r.includes('Deadline passed on'))).toBe(true);
        });

        it('Employee: evaluates personal task status without leaking company internal risk notes', () => {
            const result = ProjectHealthService.evaluate({
                projectId: 'p1',
                projectName: 'Phoenix Platform',
                endDate: new Date('2026-09-15T00:00:00.000Z'),
                totalTasks: 30,
                completedTasks: 10,
                overdueTasks: 5,
                progressPercentage: 33.3,
                isEmployeeScope: true,
                myTasks: 5,
                myCompletedTasks: 3,
                myOverdueTasks: 1,
                myProgressPercentage: 60,
            }, now);

            expect(result.status).toBe('at_risk');
            expect(result.myOverdueTasks).toBe(1);
            expect(result.myProgressPercentage).toBe(60);
            expect(result.reasons).toContain('You have 1 overdue task');
        });
    });

    describe('4. DashboardAlertService - Scope-Aware Alerts', () => {
        it('Company Admin: generates company-wide overdue alert', () => {
            const alerts = DashboardAlertService.generateAlerts({
                isCompanyWide: true,
                overdueTaskCount: 11,
                projectHealthList: [],
                attendancePercentage: 90,
                unresolvedBlockersCount: 0,
            });

            expect(alerts).toHaveLength(1);
            expect(alerts[0].message).toContain('11 tasks are overdue across the company');
        });

        it('Employee: generates personal overdue alert', () => {
            const alerts = DashboardAlertService.generateAlerts({
                isCompanyWide: false,
                overdueTaskCount: 2,
                projectHealthList: [],
                attendancePercentage: 90,
                unresolvedBlockersCount: 0,
            });

            expect(alerts).toHaveLength(1);
            expect(alerts[0].message).toBe('You have 2 overdue tasks');
        });
    });

    describe('5. DashboardCacheKey - Multi-Tenant Security & Isolation', () => {
        it('should build distinct cache keys for different companies and permission scopes', () => {
            const key1 = DashboardCacheKey.build({
                companyId: 'compA',
                userId: 'user1',
                hasLiveMonitoring: true,
                hasUserReview: true,
                query: { period: 'today' },
            });

            const key2 = DashboardCacheKey.build({
                companyId: 'compB',
                userId: 'user1',
                hasLiveMonitoring: true,
                hasUserReview: true,
                query: { period: 'today' },
            });

            expect(key1).not.toBe(key2);
            expect(key1).toContain('compA');
            expect(key2).toContain('compB');
        });
    });
});
