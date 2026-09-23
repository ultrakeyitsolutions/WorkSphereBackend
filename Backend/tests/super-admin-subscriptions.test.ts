import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { Payment } from '../src/modules/super-admin/subscriptions/payment.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        find: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/payment.model', () => ({
    Payment: {
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Subscriptions API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const validCompanyId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/subscriptions/summary - returns subscription summary and revenue metrics', async () => {
        vi.mocked(Subscription.countDocuments)
            .mockResolvedValueOnce(15 as any) // active
            .mockResolvedValueOnce(3 as any)  // trial
            .mockResolvedValueOnce(2 as any)  // expired
            .mockResolvedValueOnce(1 as any)  // cancelled
            .mockResolvedValueOnce(21 as any); // total
        vi.mocked(Payment.aggregate).mockResolvedValue([
            { _id: null, totalRevenue: 15400, transactionCount: 22 },
        ] as any);

        const res = await request(app)
            .get('/api/superadmin/subscriptions/summary')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.total).toBe(21);
        expect(res.body.data.active).toBe(15);
        expect(res.body.data.trial).toBe(3);
        expect(res.body.data.revenue.totalAmount).toBe(15400);
        expect(res.body.data.revenue.transactionCount).toBe(22);
    });

    it('GET /api/superadmin/subscriptions - returns paginated subscription list', async () => {
        const mockSub = {
            _id: 'sub_123',
            companyId: { _id: 'comp_1', name: 'Acme Corp', slug: 'acme-corp', status: 'ACTIVE' },
            planId: { _id: 'plan_1', name: 'Enterprise', slug: 'enterprise', price: 99, billingCycle: 'MONTHLY' },
            status: 'ACTIVE',
            startedAt: new Date(),
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(),
            cancelAtPeriodEnd: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(Subscription.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        sort: vi.fn().mockReturnValue({
                            skip: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue([mockSub]),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        } as any);

        vi.mocked(Subscription.countDocuments).mockResolvedValue(1 as any);

        const res = await request(app)
            .get('/api/superadmin/subscriptions?page=1&limit=10')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.subscriptions).toHaveLength(1);
        expect(res.body.data.subscriptions[0].company.name).toBe('Acme Corp');
        expect(res.body.data.subscriptions[0].plan.name).toBe('Enterprise');
        expect(res.body.data.pagination.total).toBe(1);
    });

    it('GET /api/superadmin/subscriptions/company/:companyId - returns company subscription details', async () => {
        vi.mocked(Company.findById).mockResolvedValue({ _id: validCompanyId, name: 'Acme Corp', status: 'ACTIVE' } as any);
        vi.mocked(Subscription.findOne).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        _id: 'sub_123',
                        status: 'ACTIVE',
                        planId: { _id: 'plan_1', name: 'Enterprise' },
                        scheduledPlanId: null,
                        startedAt: new Date(),
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(),
                        cancelAtPeriodEnd: false,
                    }),
                }),
            }),
        } as any);

        const res = await request(app)
            .get(`/api/superadmin/subscriptions/company/${validCompanyId}`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.companyName).toBe('Acme Corp');
        expect(res.body.data.hasActiveSubscription).toBe(true);
        expect(res.body.data.subscription.plan.name).toBe('Enterprise');
    });
});
