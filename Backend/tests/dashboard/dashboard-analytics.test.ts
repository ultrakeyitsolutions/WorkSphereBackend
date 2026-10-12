import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { DashboardDateRangeService } from '../../src/modules/dashboard/services/dashboard-date-range.service';
import { ProjectHealthService } from '../../src/modules/dashboard/services/project-health.service';
import {
    companyOverviewQuerySchema,
    deliveryTrendsQuerySchema,
    workloadQuerySchema,
    projectHealthQuerySchema,
    milestonesQuerySchema,
} from '../../src/modules/dashboard/validators/dashboard-analytics.validator';
import { CompanyOverviewAnalytics } from '../../src/modules/dashboard/analytics/company-overview.analytics';
import { DeliveryTrendsAnalytics } from '../../src/modules/dashboard/analytics/delivery-trends.analytics';
import { ProjectHealthAnalytics } from '../../src/modules/dashboard/analytics/project-health-analytics';
import { WorkloadAnalytics } from '../../src/modules/dashboard/analytics/workload.analytics';
import { AttentionAnalytics } from '../../src/modules/dashboard/analytics/attention.analytics';
import { MilestonesAnalytics } from '../../src/modules/dashboard/analytics/milestones.analytics';
import { MemberOverviewAnalytics } from '../../src/modules/dashboard/analytics/member-overview.analytics';
import { MemberTrendsAnalytics } from '../../src/modules/dashboard/analytics/member-trends.analytics';
import { MemberWorkAnalytics } from '../../src/modules/dashboard/analytics/member-work.analytics';
import { Project, ProjectStatus } from '../../src/modules/companyadmin/projects/project.model';
import { Task } from '../../src/modules/tasks/task.model';
import { TimeTracking } from '../../src/modules/task-tracking/time-tracking.model';
import { Attendance } from '../../src/modules/attendance/attendance.model';
import { LeaveRequest } from '../../src/modules/attendance/leave.model';
import { TimesheetApproval } from '../../src/modules/timesheet/timesheet-approval.model';
import { Release } from '../../src/modules/releases/release.model';
import { CompanyMember } from '../../src/modules/companyadmin/invitations/company-member.model';
import { ProjectTeamMember, ProjectInCharge } from '../../src/modules/companyadmin/projects/project.model';

describe('WorkSphere Production-Grade Dashboard Analytics Suite', () => {
    describe('1. Date Filtering, Timezone & Previous-Period Calculations', () => {
        it('resolves last_7_days with exactly 7 full days and matching previous period', () => {
            const range = DashboardDateRangeService.resolve({ period: 'last_7_days' });
            expect(range.days).toHaveLength(7);
            expect(range.previousStartDate).toBeDefined();
            expect(range.previousEndDate).toBeDefined();

            const currentDuration = range.endDate.getTime() - range.startDate.getTime();
            const prevDuration = range.previousEndDate!.getTime() - range.previousStartDate!.getTime();
            // Both must be equal duration (7 full days = 7 * 86400000 - 1 ms)
            expect(Math.round(currentDuration / 1000)).toBe(Math.round(prevDuration / 1000));
            // Previous end date must immediately precede current start date
            expect(range.previousEndDate!.getTime()).toBeLessThan(range.startDate.getTime());
        });

        it('resolves last_30_days with exactly 30 days', () => {
            const range = DashboardDateRangeService.resolve({ period: 'last_30_days' });
            expect(range.days).toHaveLength(30);
            expect(range.startDateStr).toBe(range.days[0]);
            expect(range.endDateStr).toBe(range.days[29]);
        });

        it('resolves month and last_month boundaries correctly', () => {
            const monthRange = DashboardDateRangeService.resolve({ period: 'month' });
            expect(monthRange.startDate.getDate()).toBe(1);

            const lastMonthRange = DashboardDateRangeService.resolve({ period: 'last_month' });
            expect(lastMonthRange.startDate.getDate()).toBe(1);
            expect(lastMonthRange.startDate.getTime()).toBeLessThan(lastMonthRange.endDate.getTime());
        });

        it('calculates percentage changes and handles zero denominators safely', () => {
            // Normal growth
            const growth = DashboardDateRangeService.calculatePercentageChange(150, 100);
            expect(growth.percentageChange).toBe(50);
            expect(growth.trend).toBe('UP');

            // Drop
            const drop = DashboardDateRangeService.calculatePercentageChange(75, 100);
            expect(drop.percentageChange).toBe(-25);
            expect(drop.trend).toBe('DOWN');

            // Flat
            const flat = DashboardDateRangeService.calculatePercentageChange(100, 100);
            expect(flat.percentageChange).toBe(0);
            expect(flat.trend).toBe('FLAT');

            // Zero previous denominator: Must return null and not throw or return NaN/Infinity
            const zeroPrev = DashboardDateRangeService.calculatePercentageChange(10, 0);
            expect(zeroPrev.percentageChange).toBeNull();
            expect(zeroPrev.trend).toBe('UP');

            const zeroBoth = DashboardDateRangeService.calculatePercentageChange(0, 0);
            expect(zeroBoth.percentageChange).toBeNull();
            expect(zeroBoth.trend).toBe('FLAT');
        });
    });

    describe('2. Query Validation and Boundary Enforcements', () => {
        it('accepts valid periods and custom date ranges', () => {
            const valid = companyOverviewQuerySchema.safeParse({
                query: {
                    period: 'custom',
                    startDate: '2026-09-01',
                    endDate: '2026-09-15',
                },
            });
            expect(valid.success).toBe(true);
        });

        it('rejects invalid custom ranges where startDate > endDate', () => {
            const inverted = companyOverviewQuerySchema.safeParse({
                query: {
                    period: 'custom',
                    startDate: '2026-09-20',
                    endDate: '2026-09-10',
                },
            });
            expect(inverted.success).toBe(false);
        });

        it('rejects custom ranges exceeding 365 days', () => {
            const excessive = companyOverviewQuerySchema.safeParse({
                query: {
                    period: 'custom',
                    startDate: '2024-01-01',
                    endDate: '2026-01-01',
                },
            });
            expect(excessive.success).toBe(false);
        });

        it('rejects malformed ObjectIds', () => {
            const malformed = workloadQuerySchema.safeParse({
                query: {
                    projectId: 'not-a-valid-object-id',
                },
            });
            expect(malformed.success).toBe(false);
        });

        it('clamps or defaults pagination parameters', () => {
            const result = projectHealthQuerySchema.safeParse({
                query: {
                    page: '2',
                    limit: '50',
                },
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.query.page).toBe(2);
                expect(result.data.query.limit).toBe(50);
            }
        });
    });

    describe('3. Project Health Evaluation Engine', () => {
        const now = new Date('2026-09-15T12:00:00.000Z');

        it('marks project delayed when end date passed with incomplete tasks', () => {
            const health = ProjectHealthService.evaluate(
                {
                    projectId: 'p1',
                    projectName: 'Core Platform',
                    endDate: new Date('2026-09-10T00:00:00.000Z'),
                    totalTasks: 20,
                    completedTasks: 15,
                    overdueTasks: 2,
                    progressPercentage: 75,
                },
                now
            );
            expect(health.status).toBe('delayed');
            expect(health.reasons.some((r) => r.includes('Deadline passed on'))).toBe(true);
        });

        it('marks project delayed when overdue tasks reach critical threshold (>= 8)', () => {
            const health = ProjectHealthService.evaluate(
                {
                    projectId: 'p2',
                    projectName: 'Mobile App',
                    endDate: new Date('2026-10-30T00:00:00.000Z'),
                    totalTasks: 50,
                    completedTasks: 10,
                    overdueTasks: 9,
                    progressPercentage: 20,
                },
                now
            );
            expect(health.status).toBe('delayed');
            expect(health.reasons.some((r) => r.includes('exceeds critical threshold'))).toBe(true);
        });

        it('marks project at_risk when overdue tasks >= 3 but < 8', () => {
            const health = ProjectHealthService.evaluate(
                {
                    projectId: 'p3',
                    projectName: 'API Gateway',
                    endDate: new Date('2026-10-30T00:00:00.000Z'),
                    totalTasks: 30,
                    completedTasks: 15,
                    overdueTasks: 4,
                    progressPercentage: 50,
                },
                now
            );
            expect(health.status).toBe('at_risk');
            expect(health.reasons).toContain('4 overdue tasks');
        });

        it('marks project at_risk when deadline is within 3 days and progress < 70%', () => {
            const health = ProjectHealthService.evaluate(
                {
                    projectId: 'p4',
                    projectName: 'Frontend Portal',
                    endDate: new Date('2026-09-17T00:00:00.000Z'), // 2 days away
                    totalTasks: 20,
                    completedTasks: 10,
                    overdueTasks: 0,
                    progressPercentage: 50,
                },
                now
            );
            expect(health.status).toBe('at_risk');
            expect(health.reasons.some((r) => r.includes('Deadline is within'))).toBe(true);
        });

        it('marks project on_track when on schedule with no critical overdue tasks', () => {
            const health = ProjectHealthService.evaluate(
                {
                    projectId: 'p5',
                    projectName: 'Security Audit',
                    endDate: new Date('2026-10-15T00:00:00.000Z'),
                    totalTasks: 25,
                    completedTasks: 20,
                    overdueTasks: 0,
                    progressPercentage: 80,
                },
                now
            );
            expect(health.status).toBe('on_track');
            expect(health.reasons).toContain('Project is on schedule');
        });
    });

    describe('4. Company Overview Metrics & Zero Denominators', () => {
        const companyId = new Types.ObjectId();
        const dateRange = DashboardDateRangeService.resolve({ period: 'last_7_days' });

        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('returns zero delivery rate safely when company has 0 projects', async () => {
            vi.spyOn(Project, 'aggregate').mockResolvedValue([]);
            vi.spyOn(Task, 'aggregate').mockResolvedValue([]);
            vi.spyOn(Task, 'countDocuments').mockResolvedValue(0);
            vi.spyOn(TimeTracking, 'aggregate').mockResolvedValue([]);
            vi.spyOn(Attendance, 'aggregate').mockResolvedValue([]);

            const result = await CompanyOverviewAnalytics.getOverview(companyId, dateRange);

            expect(result.projects.total).toBe(0);
            expect(result.projects.deliveryRate).toBe(0);
            expect(result.tasks.total).toBe(0);
            expect(result.periodMetrics.completionRate).toBeNull(); // 0 tasks created -> null rate
            expect(result.comparisons.completedTasks.percentageChange).toBeNull();
        });

        it('calculates project delivery rate and task completion rate correctly', async () => {
            vi.spyOn(Project, 'aggregate').mockResolvedValue([
                { total: 10, active: 6, completed: 4 },
            ]);
            vi.spyOn(Task, 'aggregate').mockResolvedValue([
                { total: 50, completed: 30, overdue: 5 },
            ]);
            // period completed = 15, period created = 20 -> rate = 75%
            vi.spyOn(Task, 'countDocuments')
                .mockResolvedValueOnce(15) // periodCompletedTasks
                .mockResolvedValueOnce(20) // periodCreatedTasks
                .mockResolvedValueOnce(10) // prevCompletedTasks
                .mockResolvedValueOnce(16); // prevCreatedTasks

            vi.spyOn(TimeTracking, 'aggregate')
                .mockResolvedValueOnce([{ totalSeconds: 72000 }]) // 20 hours
                .mockResolvedValueOnce([{ totalSeconds: 36000 }]); // 10 hours

            vi.spyOn(Attendance, 'aggregate').mockResolvedValue([{ totalMinutes: 1200 }]); // 20 hours

            const result = await CompanyOverviewAnalytics.getOverview(companyId, dateRange);

            expect(result.projects.total).toBe(10);
            expect(result.projects.active).toBe(6);
            expect(result.projects.completed).toBe(4);
            expect(result.projects.deliveryRate).toBe(40); // 4 / 10 = 40%

            expect(result.tasks.total).toBe(50);
            expect(result.tasks.completed).toBe(30);
            expect(result.tasks.open).toBe(20);
            expect(result.tasks.overdue).toBe(5);

            expect(result.periodMetrics.completedTasks).toBe(15);
            expect(result.periodMetrics.createdTasks).toBe(20);
            expect(result.periodMetrics.completionRate).toBe(75); // 15 / 20 = 75%
            expect(result.periodMetrics.trackedHours).toBe(20);

            // Previous comparison: 15 vs 10 = +50%
            expect(result.comparisons.completedTasks.percentageChange).toBe(50);
            expect(result.comparisons.completedTasks.trend).toBe('UP');
        });
    });

    describe('5. Delivery Trends Interval Bucketing', () => {
        const companyId = new Types.ObjectId();

        it('bins tasks into day buckets and computes completion rates', async () => {
            const dateRange = DashboardDateRangeService.resolve({
                period: 'custom',
                startDate: '2026-09-01',
                endDate: '2026-09-03',
            });

            vi.spyOn(Task, 'find').mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn()
                        .mockResolvedValueOnce([
                            { _id: 't1', dueDate: new Date('2026-09-01T10:00:00.000Z') },
                            { _id: 't2', dueDate: new Date('2026-09-02T10:00:00.000Z') },
                        ]) // planned
                        .mockResolvedValueOnce([
                            { _id: 't1', completedDate: new Date('2026-09-01T16:00:00.000Z') },
                        ]), // completed
                }),
            } as any);

            const trends = await DeliveryTrendsAnalytics.getTrends(companyId, dateRange, 'day');

            expect(trends.buckets).toHaveLength(3);
            expect(trends.buckets[0].plannedTasks).toBe(1);
            expect(trends.buckets[0].completedTasks).toBe(1);
            expect(trends.buckets[0].completionRate).toBe(100);

            expect(trends.buckets[1].plannedTasks).toBe(1);
            expect(trends.buckets[1].completedTasks).toBe(0);
            expect(trends.buckets[1].completionRate).toBe(0);

            // 3rd day had 0 planned -> completionRate is null
            expect(trends.buckets[2].plannedTasks).toBe(0);
            expect(trends.buckets[2].completionRate).toBeNull();
        });
    });

    describe('6. Team Workload Categorization', () => {
        const companyId = new Types.ObjectId();
        const dateRange = DashboardDateRangeService.resolve({ period: 'today' });

        it('categorizes members into overloaded, balanced, and under_capacity', async () => {
            const u1 = new Types.ObjectId();
            const u2 = new Types.ObjectId();
            const u3 = new Types.ObjectId();

            vi.spyOn(CompanyMember, 'find').mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        userId: { _id: u1, name: 'Alice Overloaded', email: 'alice@test.com', isActive: true, status: 'ACTIVE' },
                        designationId: { name: 'Lead Dev' },
                        memberType: 'EMPLOYEE',
                    },
                    {
                        userId: { _id: u2, name: 'Bob Balanced', email: 'bob@test.com', isActive: true, status: 'ACTIVE' },
                        designationId: { name: 'Full Stack' },
                        memberType: 'EMPLOYEE',
                    },
                    {
                        userId: { _id: u3, name: 'Charlie Light', email: 'charlie@test.com', isActive: true, status: 'ACTIVE' },
                        designationId: { name: 'Junior Dev' },
                        memberType: 'EMPLOYEE',
                    },
                ]),
            } as any);

            vi.spyOn(Task, 'aggregate')
                .mockResolvedValueOnce([
                    { _id: u1, openTasks: 12, overdueTasks: 4 }, // Overloaded
                    { _id: u2, openTasks: 5, overdueTasks: 1 },  // Balanced
                    { _id: u3, openTasks: 1, overdueTasks: 0 },  // Under capacity
                ])
                .mockResolvedValueOnce([]); // Completed

            vi.spyOn(TimeTracking, 'aggregate').mockResolvedValue([]);

            const workload = await WorkloadAnalytics.getWorkload(companyId, dateRange);

            expect(workload.summary.totalMembers).toBe(3);
            expect(workload.summary.overloaded).toBe(1);
            expect(workload.summary.balanced).toBe(1);
            expect(workload.summary.underCapacity).toBe(1);

            expect(workload.members[0].workloadStatus).toBe('overloaded');
            expect(workload.members[1].workloadStatus).toBe('balanced');
            expect(workload.members[2].workloadStatus).toBe('under_capacity');
        });
    });

    describe('7. Actionable Attention Items', () => {
        const companyId = new Types.ObjectId();

        it('returns actionable overdue tasks, upcoming deadlines, and pending requests', async () => {
            vi.spyOn(Task, 'countDocuments').mockResolvedValue(5);
            vi.spyOn(Task, 'find').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(),
                        title: 'Fix Auth Bug',
                        taskNumber: 'TSK-101',
                        priority: 'HIGH',
                        dueDate: new Date(Date.now() - 86400000), // 1 day overdue
                        projectId: { _id: new Types.ObjectId(), name: 'Security' },
                        assignedToId: { _id: new Types.ObjectId(), name: 'John Doe' },
                    },
                ]),
            } as any);

            vi.spyOn(Project, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            } as any);

            vi.spyOn(LeaveRequest, 'countDocuments').mockResolvedValue(2);
            vi.spyOn(LeaveRequest, 'find').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(),
                        employeeId: { _id: new Types.ObjectId(), name: 'Jane' },
                        leaveType: 'CASUAL',
                        startDate: '2026-09-20',
                        endDate: '2026-09-21',
                        totalDays: 2,
                        reason: 'Family event',
                        appliedAt: new Date(),
                    },
                ]),
            } as any);

            vi.spyOn(TimesheetApproval, 'countDocuments').mockResolvedValue(1);
            vi.spyOn(TimesheetApproval, 'find').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(),
                        userId: { _id: new Types.ObjectId(), name: 'Jane' },
                        periodStart: new Date('2026-09-01'),
                        periodEnd: new Date('2026-09-07'),
                        submittedAt: new Date(),
                    },
                ]),
            } as any);

            const attention = await AttentionAnalytics.getAttentionItems(companyId);

            expect(attention.counts.overdueTasks).toBe(5);
            expect(attention.counts.pendingLeaves).toBe(2);
            expect(attention.counts.pendingTimesheets).toBe(1);
            expect(attention.overdueTasks).toHaveLength(1);
            expect(attention.overdueTasks[0].title).toBe('Fix Auth Bug');
            expect(attention.overdueTasks[0].daysOverdue).toBeGreaterThanOrEqual(1);
            expect(attention.pendingLeaves).toHaveLength(1);
            expect(attention.pendingTimesheets).toHaveLength(1);
        });
    });

    describe('8. Milestones & Releases', () => {
        const companyId = new Types.ObjectId();

        it('filters out releases belonging to deleted projects and computes days remaining', async () => {
            const rel1 = {
                _id: new Types.ObjectId(),
                name: 'v1.0 Launch',
                version: '1.0.0',
                targetDate: new Date(Date.now() + 5 * 86400000), // 5 days remaining
                status: 'PLANNED',
                projectId: { _id: new Types.ObjectId(), name: 'Phoenix', status: 'Active', deletedAt: null },
                taskSnapshot: { totalTasks: 10, completedTasks: 6, completionPercentage: 60 },
            };
            const relDeleted = {
                _id: new Types.ObjectId(),
                name: 'Legacy Milestone',
                version: '0.1.0',
                targetDate: new Date(),
                status: 'PLANNED',
                projectId: { _id: new Types.ObjectId(), name: 'Old', status: 'Archived', deletedAt: new Date() },
            };

            vi.spyOn(Release, 'find').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([rel1, relDeleted]),
            } as any);

            const result = await MilestonesAnalytics.getMilestones(companyId);

            // relDeleted must be filtered out
            expect(result.milestones).toHaveLength(1);
            expect(result.milestones[0].name).toBe('v1.0 Launch');
            expect(result.milestones[0].progressPercentage).toBe(60);
            expect(result.milestones[0].daysRemaining).toBe(5);
            expect(result.milestones[0].isOverdue).toBe(false);
        });
    });

    describe('9. Member Overview & Self-Scoping Safeguards', () => {
        const companyId = new Types.ObjectId();
        const userId = new Types.ObjectId();
        const dateRange = DashboardDateRangeService.resolve({ period: 'last_7_days' });

        it('scopes queries strictly to authenticated member', async () => {
            vi.spyOn(ProjectTeamMember, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([{ projectId: new Types.ObjectId() }]),
            } as any);
            vi.spyOn(ProjectInCharge, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            } as any);
            vi.spyOn(Project, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            } as any);

            vi.spyOn(Task, 'aggregate').mockResolvedValue([
                { total: 10, completed: 8, overdue: 1 },
            ]);
            vi.spyOn(Task, 'countDocuments').mockResolvedValue(5);
            vi.spyOn(TimeTracking, 'aggregate').mockResolvedValue([{ totalSeconds: 36000 }]);
            vi.spyOn(Attendance, 'countDocuments').mockResolvedValue(5);
            vi.spyOn(Attendance, 'findOne').mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    status: 'CHECKED_IN',
                    actual: { firstCheckIn: new Date() },
                }),
            } as any);
            vi.spyOn(LeaveRequest, 'countDocuments').mockResolvedValue(0);
            vi.spyOn(TimesheetApproval, 'findOne').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(null),
            } as any);

            const overview = await MemberOverviewAnalytics.getOverview(companyId, userId, dateRange);

            expect(overview.meta.scope).toBe('SELF');
            expect(overview.meta.isCompanyWide).toBe(false);
            expect(overview.projects.assignedTotal).toBe(1);
            expect(overview.tasks.total).toBe(10);
            expect(overview.tasks.completed).toBe(8);
            expect(overview.tasks.completionRate).toBe(80);
            expect(overview.periodMetrics.trackedHours).toBe(10);
            expect(overview.todayAttendance.isCheckedIn).toBe(true);
        });
    });

    describe('10. Member Work Trends & My Work Prioritization', () => {
        const companyId = new Types.ObjectId();
        const userId = new Types.ObjectId();

        it('retrieves member daily work trends', async () => {
            const dateRange = DashboardDateRangeService.resolve({
                period: 'custom',
                startDate: '2026-09-01',
                endDate: '2026-09-02',
            });

            vi.spyOn(Task, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn()
                    .mockResolvedValueOnce([{ completedDate: new Date('2026-09-01T12:00:00Z') }])
                    .mockResolvedValueOnce([{ createdAt: new Date('2026-09-01T09:00:00Z') }]),
            } as any);

            vi.spyOn(TimeTracking, 'find').mockReturnValue({
                select: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([{ startedAt: new Date('2026-09-01T10:00:00Z'), workedSeconds: 7200 }]),
            } as any);

            const trends = await MemberTrendsAnalytics.getTrends(companyId, userId, dateRange, 'day');

            expect(trends.buckets).toHaveLength(2);
            expect(trends.buckets[0].tasksCompleted).toBe(1);
            expect(trends.buckets[0].tasksAssigned).toBe(1);
            expect(trends.buckets[0].trackedHours).toBe(2);
        });

        it('prioritizes in-progress and overdue tasks for member my-work', async () => {
            vi.spyOn(Task, 'find').mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: new Types.ObjectId(),
                        title: 'Urgent task',
                        priority: 'URGENT',
                        dueDate: new Date(),
                        projectId: { _id: new Types.ObjectId(), name: 'App' },
                    },
                ]),
            } as any);

            vi.spyOn(Task, 'countDocuments').mockResolvedValue(1);
            vi.spyOn(ProjectTeamMember, 'find').mockReturnValue({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) } as any);
            vi.spyOn(ProjectInCharge, 'find').mockReturnValue({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) } as any);
            vi.spyOn(Project, 'find').mockReturnValue({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) } as any);

            const myWork = await MemberWorkAnalytics.getMyWork(companyId, userId);

            expect(myWork.summary.inProgressCount).toBe(1);
            expect(myWork.inProgressTasks).toHaveLength(1);
            expect(myWork.inProgressTasks[0].title).toBe('Urgent task');
        });
    });
});
