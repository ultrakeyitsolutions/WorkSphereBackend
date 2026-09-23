import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { TimeTracking } from '../src/modules/task-tracking/time-tracking.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
    default: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
    ProjectStatus: {
        ACTIVE: 'ACTIVE',
        COMPLETED: 'COMPLETED',
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/attendance/attendance.model', () => ({
    Attendance: {
        countDocuments: vi.fn(),
    },
    AttendanceStatus: {
        CHECKED_IN: 'CHECKED_IN',
        CHECKED_OUT: 'CHECKED_OUT',
    },
}));

vi.mock('../src/modules/task-tracking/time-tracking.model', () => ({
    TimeTracking: {
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        find: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Companies Dashboard API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const validCompanyId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/companies - returns paginated company list with user counts', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(validCompanyId),
            name: 'Acme Corp',
            slug: 'acme-corp',
            domain: 'acme.com',
            status: 'ACTIVE',
            isActive: true,
            adminId: { _id: 'admin_id_1', name: 'John Doe', email: 'john@acme.com', status: 'ACTIVE' },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(Company.find).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                skip: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([mockCompany]),
                        }),
                    }),
                }),
            }),
        } as any);

        vi.mocked(Company.countDocuments).mockResolvedValue(1 as any);
        vi.mocked(User.aggregate).mockResolvedValue([{ _id: new Types.ObjectId(validCompanyId), count: 12 }] as any);
        vi.mocked(Subscription.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        companyId: new Types.ObjectId(validCompanyId),
                        status: 'ACTIVE',
                        planId: { _id: 'plan_1', name: 'Enterprise', slug: 'enterprise' },
                    },
                ]),
            }),
        } as any);

        const res = await request(app)
            .get('/api/superadmin/companies?page=1&limit=10&search=acme')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.companies).toHaveLength(1);
        expect(res.body.data.companies[0].name).toBe('Acme Corp');
        expect(res.body.data.companies[0].userCount).toBe(12);
        expect(res.body.data.companies[0].subscription.plan.name).toBe('Enterprise');
        expect(res.body.data.pagination).toEqual({
            page: 1,
            limit: 10,
            total: 1,
            totalPages: 1,
        });
    });

    it('GET /api/superadmin/companies/:companyId - returns safe company details and counts', async () => {
        const mockDetails = {
            _id: new Types.ObjectId(validCompanyId),
            name: 'Acme Corp',
            slug: 'acme-corp',
            domain: 'acme.com',
            status: 'ACTIVE',
            isActive: true,
            adminId: { _id: 'admin_id_1', name: 'John Doe', email: 'john@acme.com', status: 'ACTIVE' },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(Company.findOne).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockDetails),
            }),
        } as any);

        vi.mocked(User.countDocuments)
            .mockResolvedValueOnce(15 as any) // totalUsers
            .mockResolvedValueOnce(12 as any); // activeUsers

        vi.mocked(Project.countDocuments)
            .mockResolvedValueOnce(5 as any) // totalProjects
            .mockResolvedValueOnce(3 as any); // activeProjects

        vi.mocked(Subscription.findOne).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: 'sub_1',
                    status: 'ACTIVE',
                    planId: { name: 'Pro', slug: 'pro' },
                }),
            }),
        } as any);

        const res = await request(app)
            .get(`/api/superadmin/companies/${validCompanyId}`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Acme Corp');
        expect(res.body.data.userCount).toBe(15);
        expect(res.body.data.activeUserCount).toBe(12);
        expect(res.body.data.projectCount).toBe(5);
    });

    it('GET /api/superadmin/companies/:companyId/statistics - returns complete statistics', async () => {
        vi.mocked(Company.findById).mockResolvedValue({ _id: validCompanyId, status: 'ACTIVE' } as any);
        vi.mocked(User.countDocuments).mockResolvedValueOnce(20 as any).mockResolvedValueOnce(18 as any);
        vi.mocked(Project.countDocuments).mockResolvedValueOnce(10 as any).mockResolvedValueOnce(6 as any).mockResolvedValueOnce(4 as any);
        vi.mocked(Task.countDocuments).mockResolvedValueOnce(100 as any).mockResolvedValueOnce(60 as any);
        vi.mocked(Attendance.countDocuments).mockResolvedValueOnce(14 as any).mockResolvedValueOnce(500 as any);
        vi.mocked(TimeTracking.aggregate).mockResolvedValue([{ totalSeconds: 36000 }] as any);

        const res = await request(app)
            .get(`/api/superadmin/companies/${validCompanyId}/statistics`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.users.total).toBe(20);
        expect(res.body.data.projects.completed).toBe(4);
        expect(res.body.data.tasks.total).toBe(100);
        expect(res.body.data.attendance.activeCheckIns).toBe(14);
        expect(res.body.data.timesheet.totalWorkedHours).toBe(10);
    });
});
