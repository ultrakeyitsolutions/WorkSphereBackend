import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from '../../src/app';
import { generateAccessToken } from '../../src/utils/tokens';
import { User } from '../../src/modules/users/user.model';
import { Company } from '../../src/modules/super-admin/companies/company.model';
import { CompanyOverviewAnalytics } from '../../src/modules/dashboard/analytics/company-overview.analytics';
import { DeliveryTrendsAnalytics } from '../../src/modules/dashboard/analytics/delivery-trends.analytics';
import { ProjectHealthAnalytics } from '../../src/modules/dashboard/analytics/project-health-analytics';
import { WorkloadAnalytics } from '../../src/modules/dashboard/analytics/workload.analytics';
import { AttentionAnalytics } from '../../src/modules/dashboard/analytics/attention.analytics';
import { MilestonesAnalytics } from '../../src/modules/dashboard/analytics/milestones.analytics';
import { MemberOverviewAnalytics } from '../../src/modules/dashboard/analytics/member-overview.analytics';
import { MemberTrendsAnalytics } from '../../src/modules/dashboard/analytics/member-trends.analytics';
import { MemberWorkAnalytics } from '../../src/modules/dashboard/analytics/member-work.analytics';
import { MemberDashboardService } from '../../src/modules/companyadmin/members/member-dashboard.service';
import { EntitlementService } from '../../src/services/entitlement.service';

describe('Dashboard APIs HTTP & Security Integration Tests', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockAdminUserId = new Types.ObjectId().toString();
    const mockMemberUserId = new Types.ObjectId().toString();

    let adminToken: string;
    let memberToken: string;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(EntitlementService, 'hasFeature').mockResolvedValue(true);

        adminToken = generateAccessToken({
            userId: mockAdminUserId,
            email: 'admin@company.com',
            role: 'COMPANY_ADMIN',
            companyId: mockCompanyId,
        });

        memberToken = generateAccessToken({
            userId: mockMemberUserId,
            email: 'member@company.com',
            role: 'EMPLOYEE',
            companyId: mockCompanyId,
        });

        const mockCompanyDoc = {
            _id: new Types.ObjectId(mockCompanyId),
            status: 'ACTIVE',
            isActive: true,
            timezone: 'Asia/Kolkata',
        };

        const mockAdminDoc = {
            _id: new Types.ObjectId(mockAdminUserId),
            isActive: true,
            status: 'ACTIVE',
            companyId: new Types.ObjectId(mockCompanyId),
            role: { name: 'COMPANY_ADMIN' },
            timezone: 'Asia/Kolkata',
        };

        const mockMemberDoc = {
            _id: new Types.ObjectId(mockMemberUserId),
            isActive: true,
            status: 'ACTIVE',
            companyId: new Types.ObjectId(mockCompanyId),
            role: { name: 'EMPLOYEE' },
            timezone: 'Asia/Kolkata',
        };

        vi.spyOn(User, 'findById').mockImplementation((id: any) => {
            const isMember = String(id) === mockMemberUserId;
            const doc = isMember ? mockMemberDoc : mockAdminDoc;
            const query: any = Promise.resolve(doc);
            query.populate = vi.fn().mockResolvedValue(doc);
            query.select = vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(doc),
            });
            query.lean = vi.fn().mockResolvedValue(doc);
            return query;
        });

        vi.spyOn(Company, 'findById').mockImplementation(() => {
            const query: any = Promise.resolve(mockCompanyDoc);
            query.select = vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockCompanyDoc),
            });
            query.lean = vi.fn().mockResolvedValue(mockCompanyDoc);
            return query;
        });
    });

    describe('Company Admin Endpoints Authorization & Security', () => {
        it('GET /api/v1/company/dashboard/overview - succeeds for COMPANY_ADMIN', async () => {
            vi.spyOn(CompanyOverviewAnalytics, 'getOverview').mockResolvedValue({
                meta: { period: 'today', startDate: '2026-09-01', endDate: '2026-09-01', timezone: 'Asia/Kolkata', generatedAt: new Date().toISOString(), scope: 'COMPANY', isCompanyWide: true },
                projects: { active: 3, completed: 2, total: 5, deliveryRate: 40 },
                tasks: { total: 20, completed: 12, open: 8, overdue: 1 },
                periodMetrics: { completedTasks: 4, createdTasks: 6, completionRate: 66.67, trackedHours: 14.5, attendanceHours: 16 },
                comparisons: {
                    completedTasks: { current: 4, previous: 3, percentageChange: 33.33, trend: 'UP' },
                    createdTasks: { current: 6, previous: 5, percentageChange: 20, trend: 'UP' },
                    trackedHours: { current: 14.5, previous: 12, percentageChange: 20.83, trend: 'UP' },
                },
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/overview')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.projects.deliveryRate).toBe(40);
        });

        it('GET /api/v1/company/dashboard/overview - rejects EMPLOYEE with 403 Forbidden', async () => {
            const res = await request(app)
                .get('/api/v1/company/dashboard/overview')
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Forbidden');
        });

        it('GET /api/v1/company/dashboard/overview - rejects unauthenticated with 401', async () => {
            const res = await request(app).get('/api/v1/company/dashboard/overview');

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('GET /api/v1/company/dashboard/overview - validates custom date range and returns 422 on invalid range', async () => {
            const res = await request(app)
                .get('/api/v1/company/dashboard/overview?period=custom&startDate=2026-09-20&endDate=2026-09-10')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
        });

        it('GET /api/v1/company/dashboard/delivery-trends - returns time-bucketed trend data', async () => {
            vi.spyOn(DeliveryTrendsAnalytics, 'getTrends').mockResolvedValue({
                meta: { period: 'last_7_days', startDate: '2026-09-01', endDate: '2026-09-07', timezone: 'Asia/Kolkata', generatedAt: new Date().toISOString(), scope: 'COMPANY', isCompanyWide: true, interval: 'day' },
                summary: { totalPlanned: 10, totalCompleted: 8, overallCompletionRate: 80 },
                buckets: [],
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/delivery-trends?period=last_7_days')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.overallCompletionRate).toBe(80);
        });

        it('GET /api/v1/company/dashboard/project-health - returns health status cards', async () => {
            vi.spyOn(ProjectHealthAnalytics, 'getHealth').mockResolvedValue({
                meta: { generatedAt: new Date().toISOString(), timezone: 'UTC' },
                summary: { totalEvaluated: 4, onTrack: { count: 3, percentage: 75 }, atRisk: { count: 1, percentage: 25 }, delayed: { count: 0, percentage: 0 } },
                projects: [],
                pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/project-health')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.onTrack.percentage).toBe(75);
        });

        it('GET /api/v1/company/dashboard/workload - returns team workload distribution', async () => {
            vi.spyOn(WorkloadAnalytics, 'getWorkload').mockResolvedValue({
                meta: { period: 'today', startDate: '2026-09-01', endDate: '2026-09-01', timezone: 'Asia/Kolkata', generatedAt: new Date().toISOString(), scope: 'COMPANY', isCompanyWide: true },
                summary: { totalMembers: 5, underCapacity: 1, balanced: 3, overloaded: 1 },
                members: [],
                pagination: { page: 1, limit: 10, total: 5, totalPages: 1 },
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/workload')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.balanced).toBe(3);
        });

        it('GET /api/v1/company/dashboard/attention - returns attention items with counts', async () => {
            vi.spyOn(AttentionAnalytics, 'getAttentionItems').mockResolvedValue({
                meta: { generatedAt: new Date().toISOString(), timezone: 'UTC' },
                counts: { overdueTasks: 2, upcomingDeadlines: 3, atRiskProjects: 1, pendingLeaves: 1, pendingTimesheets: 0 },
                overdueTasks: [],
                upcomingDeadlines: [],
                atRiskProjects: [],
                pendingLeaves: [],
                pendingTimesheets: [],
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/attention')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.counts.overdueTasks).toBe(2);
        });

        it('GET /api/v1/company/dashboard/milestones - returns milestones with days remaining', async () => {
            vi.spyOn(MilestonesAnalytics, 'getMilestones').mockResolvedValue({
                meta: { generatedAt: new Date().toISOString(), timezone: 'UTC' },
                summary: { total: 2, upcoming: 1, completed: 1, overdue: 0 },
                milestones: [],
                pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
            });

            const res = await request(app)
                .get('/api/v1/company/dashboard/milestones')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.completed).toBe(1);
        });
    });

    describe('Member Endpoints Self-Scoping & Security', () => {
        it('GET /api/v1/member/dashboard/overview - succeeds for EMPLOYEE and returns self-scoped data', async () => {
            vi.spyOn(MemberOverviewAnalytics, 'getOverview').mockResolvedValue({
                meta: { period: 'last_7_days', startDate: '2026-09-01', endDate: '2026-09-07', timezone: 'Asia/Kolkata', generatedAt: new Date().toISOString(), scope: 'SELF', isCompanyWide: false },
                projects: { assignedTotal: 2 },
                tasks: { total: 10, completed: 6, open: 4, overdue: 0, completionRate: 60 },
                periodMetrics: { tasksCompleted: 4, tasksCreatedOrAssigned: 5, trackedHours: 25, attendanceDays: 5 },
                todayAttendance: { isCheckedIn: true, checkInTime: '2026-09-07T09:00:00.000Z', status: 'PRESENT' },
                pendingLeaves: 0,
                latestTimesheet: null,
            });

            const res = await request(app)
                .get('/api/v1/member/dashboard/overview?period=last_7_days')
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.meta.scope).toBe('SELF');
            expect(res.body.data.tasks.completionRate).toBe(60);
        });

        it('GET /api/v1/member/dashboard/work-trends - returns member trend buckets', async () => {
            vi.spyOn(MemberTrendsAnalytics, 'getTrends').mockResolvedValue({
                meta: { period: 'today', startDate: '2026-09-01', endDate: '2026-09-01', timezone: 'Asia/Kolkata', generatedAt: new Date().toISOString(), scope: 'SELF', isCompanyWide: false, interval: 'day' },
                summary: { totalTasksCompleted: 2, totalTrackedHours: 6.5 },
                buckets: [],
            });

            const res = await request(app)
                .get('/api/v1/member/dashboard/work-trends')
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.totalTasksCompleted).toBe(2);
        });

        it('GET /api/v1/member/dashboard/my-work - returns member work cards and projects', async () => {
            vi.spyOn(MemberWorkAnalytics, 'getMyWork').mockResolvedValue({
                meta: { generatedAt: new Date().toISOString(), timezone: 'UTC' },
                summary: { inProgressCount: 2, overdueCount: 0, upcomingCount: 1, projectsCount: 2 },
                inProgressTasks: [],
                overdueTasks: [],
                upcomingTasks: [],
                myProjects: [],
            });

            const res = await request(app)
                .get('/api/v1/member/dashboard/my-work')
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.summary.inProgressCount).toBe(2);
        });

        it('GET /api/v1/member/dashboard/stats - backward-compatible legacy stats route succeeds', async () => {
            vi.spyOn(MemberDashboardService, 'getStats').mockResolvedValue({
                projects: { total: 0, list: [] },
                tasks: { total: 0, completed: 0, pending: 0, overdue: 0, byPriority: {} },
                attendance: { isCheckedIn: false, checkInTime: null },
            } as any);

            const res = await request(app)
                .get('/api/v1/member/dashboard/stats')
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
