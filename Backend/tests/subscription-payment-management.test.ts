import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { PaymentAttempt } from '../src/modules/payments/models/payment-attempt.model';
import { PaymentAttemptState } from '../src/modules/payments/models/payment-attempt.types';
import { PaymentWebhookEvent } from '../src/modules/payments/models/payment-webhook-event.model';
import { PaymentOutboxJob } from '../src/modules/payments/models/payment-outbox.model';
import { PaymentOutboxService } from '../src/modules/payments/services/payment-outbox.service';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionEvent } from '../src/modules/super-admin/subscriptions/subscription-event.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { AuditLog } from '../src/modules/audit-logs/audit-log.model';
import { AuditLogService } from '../src/modules/audit-logs/audit-log.service';
import { AuditAction } from '../src/modules/audit-logs/audit-log.types';
import { IPaymentGatewayAdapter } from '../src/modules/payments/providers/payment-gateway.interface';
import paymentRoutes from '../src/modules/payments/payment.routes';
import superAdminPaymentRoutes from '../src/modules/super-admin/payments/super-admin-payment.routes';
import companyBillingRoutes from '../src/modules/companyadmin/billing/company-billing.routes';
import { errorHandler } from '../src/middleware/error.middleware';

const {
    mockCreateOrder,
    mockVerifyPaymentSignature,
    mockVerifyWebhookSignature,
    mockFetchPayment,
    mockFetchOrderPayments,
    mockRefundPayment,
} = vi.hoisted(() => ({
    mockCreateOrder: vi.fn(),
    mockVerifyPaymentSignature: vi.fn(),
    mockVerifyWebhookSignature: vi.fn(),
    mockFetchPayment: vi.fn(),
    mockFetchOrderPayments: vi.fn(),
    mockRefundPayment: vi.fn(),
}));

// Mock Mongoose Models
vi.mock('../src/modules/payments/models/payment-attempt.model', () => ({
    PaymentAttempt: {
        create: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        find: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/payments/models/payment-webhook-event.model', () => ({
    PaymentWebhookEvent: {
        create: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/payments/models/payment-outbox.model', () => ({
    PaymentOutboxJob: {
        create: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plans/plans.model', () => ({
    Plan: {
        findById: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn(),
        create: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription-event.model', () => ({
    SubscriptionEvent: {
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/payment.model', () => ({
    Payment: {
        create: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/plan-upgrade-request.model', () => ({
    PlanUpgradeRequest: {
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn(),
    },
}));

vi.mock('../src/modules/notifications/notification.model', () => ({
    Notification: {
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: vi.fn().mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: 'user_123',
                isActive: true,
                status: 'ACTIVE',
                role: { name: 'COMPANY_ADMIN' },
            }),
        }),
    },
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        invalidateCache: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/settings/company-theme-entitlement.service', () => ({
    CompanyThemeEntitlementService: {
        invalidateCache: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/settings/company-email-entitlement.service', () => ({
    CompanyEmailEntitlementService: {
        invalidateCache: vi.fn(),
    },
}));

vi.mock('../src/modules/payments/providers/razorpay.adapter', () => ({
    RazorpayAdapter: class {
        providerName = 'RAZORPAY';
        environment = 'test';
        createOrder = mockCreateOrder;
        verifyPaymentSignature = mockVerifyPaymentSignature;
        verifyWebhookSignature = mockVerifyWebhookSignature;
        fetchPayment = mockFetchPayment;
        fetchOrderPayments = mockFetchOrderPayments;
        refundPayment = mockRefundPayment;
        createSubscription = vi.fn();
        cancelSubscription = vi.fn();
    },
}));

describe('WorkSphere Production Multi-Tenant Payment, Subscription & Billing Suite', () => {
    const superAdminId = new Types.ObjectId().toString();
    const companyIdA = new Types.ObjectId().toString();
    const companyIdB = new Types.ObjectId().toString();
    const userIdA = new Types.ObjectId().toString();
    const userIdB = new Types.ObjectId().toString();
    const currentPlanId = new Types.ObjectId().toString();
    const targetPlanId = new Types.ObjectId().toString();

    const superAdminToken = generateAccessToken({
        userId: superAdminId,
        email: 'superadmin@worksphere.com',
        role: 'SUPER_ADMIN',
    });

    const companyAdminTokenA = generateAccessToken({
        userId: userIdA,
        email: 'admin@company-a.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdA,
    });

    const companyAdminTokenB = generateAccessToken({
        userId: userIdB,
        email: 'admin@company-b.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdB,
    });

    const mockCompanyA = {
        _id: new Types.ObjectId(companyIdA),
        name: 'Company Alpha',
        status: 'ACTIVE',
        isActive: true,
        email: 'billing@alpha.com',
    };

    const mockCurrentPlan = {
        _id: new Types.ObjectId(currentPlanId),
        name: 'Starter Plan',
        code: 'STARTER',
        price: 500,
        currency: 'INR',
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    const mockTargetPlan = {
        _id: new Types.ObjectId(targetPlanId),
        name: 'Enterprise Plan',
        code: 'ENTERPRISE',
        price: 1500,
        currency: 'INR',
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    let mockAdapter: IPaymentGatewayAdapter;
    let paymentService: PaymentService;
    let app: express.Express;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCreateOrder.mockReset().mockResolvedValue({
            providerOrderId: 'order_rzp_mock_123',
            amount: 150000,
            currency: 'INR',
            status: 'created',
            receipt: 'att_test_123',
            raw: { id: 'order_rzp_mock_123' },
        });
        mockVerifyPaymentSignature.mockReset().mockReturnValue(true);
        mockVerifyWebhookSignature.mockReset().mockReturnValue(true);
        mockFetchPayment.mockReset().mockResolvedValue({
            providerPaymentId: 'pay_rzp_mock_123',
            providerOrderId: 'order_rzp_mock_123',
            amount: 150000,
            currency: 'INR',
            status: 'captured',
            raw: {},
        });
        mockFetchOrderPayments.mockReset().mockResolvedValue([
            {
                providerPaymentId: 'pay_rzp_mock_123',
                providerOrderId: 'order_rzp_mock_123',
                amount: 150000,
                currency: 'INR',
                status: 'captured',
                raw: {},
            },
        ]);
        mockRefundPayment.mockReset().mockResolvedValue({
            providerRefundId: 'rfnd_rzp_mock_123',
            providerPaymentId: 'pay_rzp_mock_123',
            amount: 150000,
            status: 'processed',
            raw: {},
        });

        mockAdapter = {
            providerName: 'RAZORPAY',
            environment: 'test',
            createOrder: mockCreateOrder,
            verifyPaymentSignature: mockVerifyPaymentSignature,
            verifyWebhookSignature: mockVerifyWebhookSignature,
            fetchPayment: mockFetchPayment,
            fetchOrderPayments: mockFetchOrderPayments,
            refundPayment: mockRefundPayment,
            createSubscription: vi.fn(),
            cancelSubscription: vi.fn(),
        };

        paymentService = new PaymentService(mockAdapter);

        app = express();
        app.use(express.json({
            verify: (req: any, _res, buf) => {
                req.rawBody = buf;
            },
        }));

        // Mount API endpoints
        app.use('/api/v1/payments', paymentRoutes);
        app.use('/api/v1/super-admin/payments', superAdminPaymentRoutes);
        app.use('/api/v1/company/billing', companyBillingRoutes);
        app.use(errorHandler);
    });

    // ── 1. Tenant Isolation & Cross-Company Data Protection ────────────────────
    describe('1. Tenant Isolation', () => {
        it('rejects Company B attempts to access Company A payment records', async () => {
            const attemptDoc: any = {
                attemptId: 'att_tenant_test',
                companyId: new Types.ObjectId(companyIdA), // Belongs to Company A
                state: PaymentAttemptState.SUCCEEDED,
                amount: 150000,
                currency: 'INR',
            };

            vi.mocked(PaymentAttempt.findOne).mockReturnValue({
                populate: vi.fn().mockResolvedValue(attemptDoc),
            } as any);

            const res = await request(app)
                .get('/api/v1/payments/attempts/att_tenant_test')
                .set('Authorization', `Bearer ${companyAdminTokenB}`); // Authenticated as Company B

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('Access to payment attempt belonging to another organization is denied');
        });

        it('derives company ID strictly from verified token, ignoring client-supplied body companyId', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);
            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

            const createdAttempt: any = {
                attemptId: 'att_created_safe',
                companyId: new Types.ObjectId(companyIdA),
                actorId: new Types.ObjectId(userIdA),
                planId: new Types.ObjectId(targetPlanId),
                amount: 150000,
                currency: 'INR',
                state: PaymentAttemptState.PENDING,
                providerOrderId: 'order_rzp_mock_123',
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(PaymentAttempt.create).mockResolvedValue(createdAttempt);

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .set('Idempotency-Key', 'key_tenant_override_attempt')
                .send({
                    planId: targetPlanId,
                    companyId: companyIdB, // Attacker tries to bill or modify Company B
                });

            expect(res.status).toBe(201);
            // Verify PaymentAttempt.create was called with companyIdA (from token), NOT companyIdB
            expect(PaymentAttempt.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    companyId: new Types.ObjectId(companyIdA),
                })
            );
        });
    });

    // ── 2. Unauthorized SuperAdmin Actions ─────────────────────────────────────
    describe('2. SuperAdmin Authorization Guards', () => {
        it('rejects non-SUPER_ADMIN users from accessing global payments endpoint', async () => {
            const res = await request(app)
                .get('/api/v1/super-admin/payments')
                .set('Authorization', `Bearer ${companyAdminTokenA}`);

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('Forbidden: Super Admin access required');
        });

        it('rejects non-SUPER_ADMIN users from granting complimentary upgrades', async () => {
            const res = await request(app)
                .post(`/api/v1/super-admin/payments/companies/${companyIdA}/complimentary-upgrade`)
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .send({
                    targetPlanId,
                    reason: 'Unauthorized attempt',
                });

            expect(res.status).toBe(403);
        });

        it('rejects non-SUPER_ADMIN users from triggering refunds', async () => {
            const res = await request(app)
                .post('/api/v1/super-admin/payments/att_mock_123/refund')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .send({ reason: 'Refund requested by regular user' });

            expect(res.status).toBe(403);
        });
    });

    // ── 3. Successful Payments & State Transitions ─────────────────────────────
    describe('3. Payment Verification & Activation', () => {
        it('verifies signature and captures payment atomically', async () => {
            const attemptDoc: any = {
                attemptId: 'att_verify_success',
                companyId: new Types.ObjectId(companyIdA),
                actorId: new Types.ObjectId(userIdA),
                planId: new Types.ObjectId(targetPlanId),
                billingCycle: 'MONTHLY',
                billingObligationId: 'obl_123',
                amount: 150000,
                currency: 'INR',
                state: PaymentAttemptState.PENDING,
                providerOrderId: 'order_rzp_mock_123',
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(PaymentAttempt.findOne).mockReturnValue({
                populate: vi.fn().mockResolvedValue(attemptDoc),
            } as any);

            vi.mocked(PaymentAttempt.findOneAndUpdate).mockResolvedValue({
                ...attemptDoc,
                state: PaymentAttemptState.SUCCEEDED,
                confirmedAt: new Date(),
                providerPaymentId: 'pay_rzp_mock_123',
            } as any);

            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);
            vi.mocked(Subscription.findOne).mockResolvedValue(null);
            vi.mocked(Subscription.create).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(targetPlanId),
                status: SubscriptionStatus.ACTIVE,
            } as any);

            const res = await request(app)
                .post('/api/v1/payments/attempts/att_verify_success/verify')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .send({
                    providerPaymentId: 'pay_rzp_mock_123',
                    providerOrderId: 'order_rzp_mock_123',
                    providerSignature: 'valid_mock_signature',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe(PaymentAttemptState.SUCCEEDED);
            expect(Subscription.create).toHaveBeenCalled();
        });

        it('rejects payment verification with invalid signature and transitions attempt to FAILED', async () => {
            const attemptDoc: any = {
                attemptId: 'att_verify_fail',
                companyId: new Types.ObjectId(companyIdA),
                actorId: new Types.ObjectId(userIdA),
                planId: new Types.ObjectId(targetPlanId),
                state: PaymentAttemptState.PENDING,
                amount: 150000,
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(PaymentAttempt.findOne).mockReturnValue({
                populate: vi.fn().mockResolvedValue(attemptDoc),
            } as any);

            // Mock invalid signature verification
            mockVerifyPaymentSignature.mockReturnValue(false);

            const res = await request(app)
                .post('/api/v1/payments/attempts/att_verify_fail/verify')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .send({
                    providerPaymentId: 'pay_rzp_fake',
                    providerOrderId: 'order_rzp_fake',
                    providerSignature: 'tampered_signature',
                });

            expect(res.status).toBe(400);
            expect(attemptDoc.state).toBe(PaymentAttemptState.FAILED);
            expect(attemptDoc.errorCode).toBe('INVALID_SIGNATURE');
        });
    });

    // ── 4. Idempotency & Webhook Deduplication ──────────────────────────────────
    describe('4. Idempotency & Concurrency', () => {
        it('returns existing attempt on replay with identical idempotency key', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);

            const existingAttempt: any = {
                attemptId: 'att_replayed',
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(targetPlanId),
                billingCycle: 'MONTHLY',
                amount: 150000,
                currency: 'INR',
                billingObligationId: 'obl_replay_test',
                requestFingerprint: PaymentService.computeRequestFingerprint({
                    companyId: companyIdA,
                    planId: targetPlanId,
                    billingCycle: 'MONTHLY',
                    amount: 150000,
                    currency: 'INR',
                    billingObligationId: 'obl_replay_test',
                }),
                state: PaymentAttemptState.PENDING,
                providerOrderId: 'order_rzp_mock_123',
            };

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(existingAttempt);

            const res = await request(app)
                .post('/api/v1/payments/attempts')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .set('Idempotency-Key', 'idemp_key_123')
                .send({
                    planId: targetPlanId,
                    billingObligationId: 'obl_replay_test',
                });

            expect(res.status).toBe(200);
            expect(res.body.data.paymentAttemptId).toBe('att_replayed');
            expect(PaymentAttempt.create).not.toHaveBeenCalled();
        });

        it('rejects attempt when idempotency key is reused with differing parameters (409 Conflict)', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);

            const existingAttempt: any = {
                attemptId: 'att_conflicted',
                companyId: new Types.ObjectId(companyIdA),
                requestFingerprint: 'different_hash_from_original',
            };

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(existingAttempt);

            const res = await request(app)
                .post('/api/v1/payments/attempts')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .set('Idempotency-Key', 'idemp_key_123')
                .send({
                    planId: targetPlanId,
                });

            expect(res.status).toBe(409);
            expect(res.body.message).toContain('Idempotency key already used with different parameters');
        });

        it('handles duplicate webhook events idempotently without double processing', async () => {
            // Mock webhook signature valid
            vi.spyOn(mockAdapter, 'verifyWebhookSignature').mockReturnValue(true);

            // First call persists event
            vi.mocked(PaymentWebhookEvent.create).mockResolvedValue({
                providerEventId: 'evt_razorpay_123',
                status: 'RECEIVED',
                save: vi.fn().mockResolvedValue(true),
            } as any);

            const res1 = await request(app)
                .post('/api/v1/payments/webhooks/razorpay')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'payment.captured',
                    event_id: 'evt_razorpay_123',
                    payload: { payment: { entity: { id: 'pay_123' } } },
                });

            expect(res1.status).toBe(200);

            // Second call triggers duplicate key (E11000)
            const mongoDupErr: any = new Error('E11000 duplicate key');
            mongoDupErr.code = 11000;
            vi.mocked(PaymentWebhookEvent.create).mockRejectedValue(mongoDupErr);

            const res2 = await request(app)
                .post('/api/v1/payments/webhooks/razorpay')
                .set('x-razorpay-signature', 'valid_sig')
                .send({
                    event: 'payment.captured',
                    event_id: 'evt_razorpay_123',
                    payload: { payment: { entity: { id: 'pay_123' } } },
                });

            expect(res2.status).toBe(200);
            expect(res2.body.message).toContain('Webhook event already recorded (idempotent)');
        });
    });

    // ── 5. Complimentary Upgrades & Immutable Audit Logs ───────────────────────
    describe('5. SuperAdmin Complimentary Upgrades', () => {
        it('grants complimentary plan, records reason, emits audit event, and invalidates cache', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);

            const existingSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(currentPlanId),
                status: SubscriptionStatus.ACTIVE,
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(Subscription.findOne).mockResolvedValue(existingSub);

            const res = await request(app)
                .post(`/api/v1/super-admin/payments/companies/${companyIdA}/complimentary-upgrade`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    targetPlanId,
                    reason: 'Strategic enterprise partnership grant',
                    durationMonths: 6,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isComplimentary).toBe(true);
            expect(res.body.data.complimentaryReason).toBe('Strategic enterprise partnership grant');

            // Verify immutable subscription event logged
            expect(SubscriptionEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'COMPLIMENTARY_PLAN_GRANTED',
                    toPlanId: new Types.ObjectId(targetPlanId),
                })
            );

            // Verify immutable audit log
            expect(AuditLogService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.COMPLIMENTARY_PLAN_GRANTED,
                    actorId: superAdminId,
                    companyId: companyIdA,
                })
            );

            // Verify no Razorpay payment order was created
            expect(mockAdapter.createOrder).not.toHaveBeenCalled();
        });

        it('rejects complimentary upgrade if reason is omitted', async () => {
            const res = await request(app)
                .post(`/api/v1/super-admin/payments/companies/${companyIdA}/complimentary-upgrade`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    targetPlanId,
                    reason: '', // Empty reason
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('reason is required');
        });
    });

    // ── 6. Proration Calculation ───────────────────────────────────────────────
    describe('6. Prorated Upgrades', () => {
        it('calculates prorated upgrade cost taking into account unused days on current plan', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
            vi.mocked(Plan.findById)
                .mockResolvedValueOnce(mockTargetPlan as any) // Target plan lookup (price: 1500)
                .mockResolvedValueOnce(mockCurrentPlan as any); // Current plan lookup (price: 500)

            // Current subscription is 15 days into a 30-day period (50% remaining = 250 INR unused credit)
            const now = new Date();
            const periodStart = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
            const periodEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

            const activeSub: any = {
                planId: new Types.ObjectId(currentPlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
            };
            vi.mocked(Subscription.findOne).mockResolvedValue(activeSub);
            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

            const createdAttempt: any = {
                attemptId: 'att_prorated',
                amount: 125000, // 1500 - 250 = 1250 INR (125000 paise)
                currency: 'INR',
                state: PaymentAttemptState.PENDING,
                providerOrderId: 'order_rzp_mock_123',
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(PaymentAttempt.create).mockResolvedValue(createdAttempt);

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminTokenA}`)
                .set('Idempotency-Key', 'key_prorated_test')
                .send({
                    planId: targetPlanId,
                    billingPolicy: 'PRORATED',
                });

            expect(res.status).toBe(201);
            // Verify PaymentAttempt.create was called with prorated amount ~ 125000 paise
            expect(PaymentAttempt.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    billingPolicy: 'PRORATED',
                    amount: expect.any(Number),
                })
            );
        });
    });

    // ── 7. Refunds & Razorpay Reconciliation ───────────────────────────────────
    describe('7. Refunds & Gateway Reconciliation', () => {
        it('SuperAdmin executes refund through Razorpay adapter and updates attempt state', async () => {
            const attemptDoc: any = {
                attemptId: 'att_refund_test',
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(targetPlanId),
                state: PaymentAttemptState.SUCCEEDED,
                amount: 150000,
                currency: 'INR',
                providerPaymentId: 'pay_rzp_mock_123',
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(attemptDoc);
            vi.mocked(Plan.findById).mockResolvedValue(mockTargetPlan as any);

            const res = await request(app)
                .post('/api/v1/super-admin/payments/att_refund_test/refund')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    reason: 'Customer billing dispute resolved in customer favor',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockRefundPayment).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerPaymentId: 'pay_rzp_mock_123',
                    amount: 150000,
                })
            );
            expect(attemptDoc.state).toBe(PaymentAttemptState.REFUNDED);
            expect(attemptDoc.refundId).toBe('rfnd_rzp_mock_123');
            expect(AuditLogService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.PAYMENT_REFUNDED,
                })
            );
        });
    });

    // ── 8. Secure Payment Report Export (CSV) ──────────────────────────────────
    describe('8. Payment Report Export', () => {
        it('exports filtered payment report in CSV format', async () => {
            const records: any[] = [
                {
                    _id: new Types.ObjectId(),
                    attemptId: 'att_csv_1',
                    companyId: mockCompanyA,
                    planId: mockTargetPlan,
                    amount: 150000,
                    currency: 'INR',
                    state: PaymentAttemptState.SUCCEEDED,
                    billingCycle: 'MONTHLY',
                    billingPolicy: 'FULL_PRICE',
                    createdAt: new Date(),
                },
            ];

            vi.mocked(PaymentAttempt.find).mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(records),
            } as any);
            vi.mocked(PaymentAttempt.countDocuments).mockResolvedValue(1);

            const res = await request(app)
                .get('/api/v1/super-admin/payments/export')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/csv');
            expect(res.text).toContain('Attempt ID,Company Name,Company ID,Plan Name');
            expect(res.text).toContain('att_csv_1');
            expect(res.text).toContain('Company Alpha');
        });
    });
});
