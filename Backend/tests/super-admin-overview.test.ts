import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { generateAccessToken } from '../src/utils/tokens';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import superAdminRouter from '../src/modules/super-admin';

// Mock mongoose models
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        countDocuments: vi.fn(),
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
    },
    default: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        countDocuments: vi.fn(),
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
    },
    default: {
        countDocuments: vi.fn(),
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        countDocuments: vi.fn(),
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
    },
    ProjectStatus: {
        ACTIVE: 'ACTIVE',
        COMPLETED: 'COMPLETED',
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        countDocuments: vi.fn(),
        find: vi.fn(),
        findOne: vi.fn(),
    },
    SubscriptionStatus: {
        ACTIVE: 'ACTIVE',
        TRIALING: 'TRIALING',
        EXPIRED: 'EXPIRED',
        CANCELLED: 'CANCELLED',
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Overview API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const regularUserToken = generateAccessToken({
        userId: 'user_456',
        email: 'user@acme.com',
        role: 'EMPLOYEE',
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/overview/summary - 401 when unauthenticated', async () => {
        const res = await request(app).get('/api/superadmin/overview/summary');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('GET /api/superadmin/overview/summary - 403 when user is not SUPER_ADMIN', async () => {
        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: 'user_456',
                email: 'user@acme.com',
                isActive: true,
                status: 'ACTIVE',
                role: { name: 'EMPLOYEE' },
            }),
        } as any);

        const res = await request(app)
            .get('/api/superadmin/overview/summary')
            .set('Authorization', `Bearer ${regularUserToken}`);
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('GET /api/superadmin/overview/summary - 200 with aggregated metrics for SUPER_ADMIN', async () => {
        // Companies counts: total (10), active (8), new (2)
        vi.mocked(Company.countDocuments)
            .mockResolvedValueOnce(10 as any)
            .mockResolvedValueOnce(8 as any)
            .mockResolvedValueOnce(2 as any);

        // Users counts: total (50), active (45), new (5)
        vi.mocked(User.countDocuments)
            .mockResolvedValueOnce(50 as any)
            .mockResolvedValueOnce(45 as any)
            .mockResolvedValueOnce(5 as any);

        // Projects counts: total (20), active (15), completed (5)
        vi.mocked(Project.countDocuments)
            .mockResolvedValueOnce(20 as any)
            .mockResolvedValueOnce(15 as any)
            .mockResolvedValueOnce(5 as any);

        // Subscriptions counts: active (8), trial (1), expired (1), cancelled (0)
        vi.mocked(Subscription.countDocuments)
            .mockResolvedValueOnce(8 as any)
            .mockResolvedValueOnce(1 as any)
            .mockResolvedValueOnce(1 as any)
            .mockResolvedValueOnce(0 as any);

        const res = await request(app)
            .get('/api/superadmin/overview/summary')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            companies: { total: 10, active: 8, new: 2 },
            users: { total: 50, active: 45, new: 5 },
            projects: { total: 20, active: 15, completed: 5 },
            subscriptions: { active: 8, trial: 1, expired: 1, cancelled: 0 },
        });
    });
});
