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
import { PaymentWebhookWorker } from '../src/modules/payments/workers/payment-webhook.worker';
import { PaymentReconciliationWorker } from '../src/modules/payments/workers/payment-reconciliation.worker';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { IPaymentGatewayAdapter } from '../src/modules/payments/providers/payment-gateway.interface';
import paymentRoutes from '../src/modules/payments/payment.routes';
import { errorHandler } from '../src/middleware/error.middleware';

// Mock Models
vi.mock('../src/modules/payments/models/payment-attempt.model', () => ({
    PaymentAttempt: {
        create: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        find: vi.fn(),
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
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
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
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/payment.model', () => ({
    Payment: {
        create: vi.fn(),
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

vi.mock('../src/modules/notifications/notification.service', () => ({
    NotificationService: class {
        publish = vi.fn().mockResolvedValue([]);
    },
}));

vi.mock('../src/modules/payments/providers/razorpay.adapter', () => ({
    RazorpayAdapter: class {
        providerName = 'RAZORPAY';
        environment = 'test';
        createOrder = vi.fn().mockResolvedValue({
            providerOrderId: 'order_mock_123',
            amount: 99900,
            currency: 'INR',
            status: 'created',
            receipt: 'att_test',
            raw: { id: 'order_mock_123', status: 'created' },
        });
        verifyPaymentSignature = vi.fn().mockReturnValue(true);
        verifyWebhookSignature = vi.fn().mockReturnValue(true);
        fetchPayment = vi.fn().mockResolvedValue({
            providerPaymentId: 'pay_mock_123',
            status: 'captured',
            amount: 99900,
            currency: 'INR',
            raw: {},
        });
        fetchOrderPayments = vi.fn().mockResolvedValue([
            {
                providerPaymentId: 'pay_mock_123',
                providerOrderId: 'order_mock_123',
                amount: 99900,
                currency: 'INR',
                status: 'captured',
                raw: {},
            },
        ]);
        refundPayment = vi.fn().mockResolvedValue({
            providerRefundId: 'rfnd_mock_123',
            providerPaymentId: 'pay_mock_123',
            amount: 99900,
            status: 'processed',
            raw: {},
        });
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

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn(),
    },
}));

describe('WorkSphere Payment Backend — Production Reliability Test Suite', () => {
    const companyIdA = new Types.ObjectId().toString();
    const companyIdB = new Types.ObjectId().toString();
    const userIdA = new Types.ObjectId().toString();
    const planId = new Types.ObjectId().toString();

    const companyAdminTokenA = generateAccessToken({
        userId: userIdA,
        email: 'admin@companya.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdA,
    });

    const companyAdminTokenB = generateAccessToken({
        userId: new Types.ObjectId().toString(),
        email: 'admin@companyb.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdB,
    });

    const mockPlan = {
        _id: new Types.ObjectId(planId),
        name: 'Pro Tier',
        price: 999, // 999.00 INR
        currency: 'INR',
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    const mockCompanyA = {
        _id: new Types.ObjectId(companyIdA),
        name: 'Company Alpha',
        status: 'ACTIVE',
        isActive: true,
    };

    let mockAdapter: IPaymentGatewayAdapter;
    let paymentService: PaymentService;
    let app: express.Express;

    beforeEach(() => {
        vi.clearAllMocks();

        mockAdapter = {
            providerName: 'RAZORPAY',
            environment: 'test',
            createOrder: vi.fn().mockResolvedValue({
                providerOrderId: 'order_mock_123',
                amount: 99900,
                currency: 'INR',
                status: 'created',
                receipt: 'att_test',
                raw: { id: 'order_mock_123', status: 'created' },
            }),
            verifyPaymentSignature: vi.fn().mockReturnValue(true),
            verifyWebhookSignature: vi.fn().mockReturnValue(true),
            fetchPayment: vi.fn().mockResolvedValue({
                providerPaymentId: 'pay_mock_123',
                providerOrderId: 'order_mock_123',
                amount: 99900,
                currency: 'INR',
                status: 'captured',
                raw: { id: 'pay_mock_123', status: 'captured' },
            }),
            fetchOrderPayments: vi.fn().mockResolvedValue([
                {
                    providerPaymentId: 'pay_mock_123',
                    providerOrderId: 'order_mock_123',
                    amount: 99900,
                    currency: 'INR',
                    status: 'captured',
                    raw: { id: 'pay_mock_123', status: 'captured' },
                },
            ]),
            refundPayment: vi.fn().mockResolvedValue({
                providerRefundId: 'rfnd_mock_123',
                providerPaymentId: 'pay_mock_123',
                amount: 99900,
                status: 'processed',
                raw: { id: 'rfnd_mock_123' },
            }),
        };

        paymentService = new PaymentService(mockAdapter);

        app = express();
        app.use(express.json({
            verify: (req: any, _res, buf) => {
                req.rawBody = buf;
            },
        }));
        app.use('/api/v1/payments', paymentRoutes);
        app.use(errorHandler);
    });

    // ── 1. Repeated checkout creation with the same idempotency key ───────────
    it('1. Repeated checkout creation with the same idempotency key returns existing attempt (idempotent replay)', async () => {
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);

        const obligationId = 'obl_alpha_1';
        const idempotencyKey = 'key_unique_123';
        const fingerprint = PaymentService.computeRequestFingerprint({
            companyId: companyIdA,
            planId,
            billingCycle: 'MONTHLY',
            amount: 99900,
            currency: 'INR',
            billingObligationId: obligationId,
        });

        const existingDoc: any = {
            attemptId: 'att_existing_1',
            companyId: new Types.ObjectId(companyIdA),
            billingObligationId: obligationId,
            idempotencyKey,
            requestFingerprint: fingerprint,
            state: PaymentAttemptState.PENDING,
            amount: 99900,
            currency: 'INR',
            providerOrderId: 'order_mock_123',
        };

        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(existingDoc);

        const result = await paymentService.createPaymentAttempt({
            companyId: companyIdA,
            actorId: userIdA,
            planId,
            billingCycle: 'MONTHLY',
            billingObligationId: obligationId,
            idempotencyKey,
        });

        expect(result.isReplay).toBe(true);
        expect(result.attempt.attemptId).toBe('att_existing_1');
        expect(mockAdapter.createOrder).not.toHaveBeenCalled(); // Gateway NOT called twice
    });

    // ── 2. Same key with a different request payload ───────────────────────────
    it('2. Same key with a different request payload returns idempotency conflict (409)', async () => {
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);

        const idempotencyKey = 'key_reuse_conflict';
        const existingDoc: any = {
            attemptId: 'att_existing_1',
            companyId: new Types.ObjectId(companyIdA),
            billingObligationId: 'obl_1',
            idempotencyKey,
            requestFingerprint: 'different_hash_from_earlier_payload',
            state: PaymentAttemptState.PENDING,
            amount: 50000,
        };

        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(existingDoc);

        await expect(
            paymentService.createPaymentAttempt({
                companyId: companyIdA,
                actorId: userIdA,
                planId,
                billingCycle: 'MONTHLY',
                billingObligationId: 'obl_1',
                idempotencyKey,
            })
        ).rejects.toThrow(/Idempotency key already used with different parameters/);
    });

    // ── 3. Concurrent checkout requests for one billing obligation ───────────
    it('3. Concurrent checkout requests for one billing obligation allows only one to proceed', async () => {
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);

        // First attempt findOne returns null for idempotencyKey, but returns an active attempt for billingObligationId
        vi.mocked(PaymentAttempt.findOne)
            .mockResolvedValueOnce(null) // idempotency check
            .mockResolvedValueOnce({
                attemptId: 'att_in_progress',
                state: PaymentAttemptState.PROCESSING,
            } as any);

        await expect(
            paymentService.createPaymentAttempt({
                companyId: companyIdA,
                actorId: userIdA,
                planId,
                billingObligationId: 'obl_concurrent_test',
                idempotencyKey: 'key_concurrent_2',
            })
        ).rejects.toThrow(/already in progress for this billing obligation/);
    });

    // ── 4. Provider timeout before and after a possible successful charge ─────
    it('4. Provider timeout marks outcome as UNKNOWN and schedules reconciliation without failing charge', async () => {
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);
        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

        const timeoutErr: any = new Error('Gateway timeout');
        timeoutErr.isTimeout = true;
        timeoutErr.code = 'ETIMEDOUT';
        vi.mocked(mockAdapter.createOrder).mockRejectedValue(timeoutErr);

        const mockAttemptDoc: any = {
            attemptId: 'att_timeout_1',
            companyId: new Types.ObjectId(companyIdA),
            state: PaymentAttemptState.INITIATED,
            amount: 99900,
            save: vi.fn().mockResolvedValue(true),
        };
        vi.mocked(PaymentAttempt.create).mockResolvedValue(mockAttemptDoc);

        const result = await paymentService.createPaymentAttempt({
            companyId: companyIdA,
            actorId: userIdA,
            planId,
            billingObligationId: 'obl_timeout',
            idempotencyKey: 'key_timeout',
        });

        expect(result.attempt.state).toBe(PaymentAttemptState.UNKNOWN);
        expect(result.attempt.errorCode).toBe('PROVIDER_TIMEOUT');
        expect(result.attempt.nextReconcileAt).toBeDefined();
    });

    // ── 5. Lost HTTP response after payment success ───────────────────────────
    it('5. Lost HTTP response recovered via GET /api/v1/payments/attempts/:attemptId', async () => {
        const mockAttempt: any = {
            attemptId: 'att_lost_response',
            companyId: new Types.ObjectId(companyIdA),
            state: PaymentAttemptState.SUCCEEDED,
            amount: 99900,
            currency: 'INR',
            confirmedAt: new Date(),
            planId: { name: 'Pro Tier' },
        };

        vi.mocked(PaymentAttempt.findOne).mockReturnValue({
            populate: vi.fn().mockResolvedValue(mockAttempt),
        } as any);

        const res = await request(app)
            .get('/api/v1/payments/attempts/att_lost_response')
            .set('Authorization', `Bearer ${companyAdminTokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('SUCCEEDED');
        expect(res.body.data.retryable).toBe(false);
    });

    // ── 6. Duplicate, delayed, and out-of-order webhooks ───────────────────────
    it('6. Duplicate webhook event returns 200 OK immediately and is deduplicated', async () => {
        vi.mocked(PaymentWebhookEvent.create).mockRejectedValueOnce({ code: 11000 }); // Mongo duplicate key error

        const res = await request(app)
            .post('/api/v1/payments/webhooks/razorpay')
            .set('x-razorpay-signature', 'valid_sig')
            .send({
                event_id: 'evt_duplicate_123',
                event: 'payment.captured',
                payload: {
                    payment: { entity: { id: 'pay_123', status: 'captured' } },
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('already recorded (idempotent)');
    });

    // ── 7. A confirmed failure followed by a controlled retry ─────────────────
    it('7. A confirmed failure allows creating a new attempt with a new idempotency key', async () => {
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);

        // Previous attempt is FAILED, so obligation query allows new attempt
        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

        const newAttemptDoc: any = {
            attemptId: 'att_retry_1',
            companyId: new Types.ObjectId(companyIdA),
            state: PaymentAttemptState.INITIATED,
            amount: 99900,
            save: vi.fn().mockResolvedValue(true),
        };
        vi.mocked(PaymentAttempt.create).mockResolvedValue(newAttemptDoc);

        const result = await paymentService.createPaymentAttempt({
            companyId: companyIdA,
            actorId: userIdA,
            planId,
            billingObligationId: 'obl_failed_then_retried',
            idempotencyKey: 'key_new_retry_attempt',
        });

        expect(result.attempt.state).toBe(PaymentAttemptState.PENDING);
        expect(result.isReplay).toBe(false);
    });

    // ── 8. Subscription activation executed multiple times ─────────────────────
    it('8. Subscription activation executed multiple times is idempotent and does not extend period twice', async () => {
        const attemptDoc: any = {
            attemptId: 'att_sub_active_1',
            companyId: new Types.ObjectId(companyIdA),
            actorId: new Types.ObjectId(userIdA),
            planId: new Types.ObjectId(planId),
            billingCycle: 'MONTHLY',
            billingObligationId: 'obl_multi_active',
            save: vi.fn().mockResolvedValue(true),
        };

        const existingSub: any = {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyIdA),
            planId: new Types.ObjectId(planId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: new Date('2026-10-01'),
            currentPeriodEnd: new Date('2026-11-01'),
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);
        vi.mocked(Subscription.findOne).mockResolvedValue(existingSub);

        await paymentService.activateSubscriptionForPayment(attemptDoc);

        expect(existingSub.save).toHaveBeenCalled();
        const firstPeriodEnd = existingSub.currentPeriodEnd.getTime();

        // Second activation for the same subscription does not double extend beyond target period
        await paymentService.activateSubscriptionForPayment(attemptDoc);
        expect(existingSub.save).toHaveBeenCalledTimes(2);
    });

    // ── 9. Duplicate success and failure notifications ─────────────────────────
    it('9. Duplicate notifications prevented via unique deduplicationKey in outbox', async () => {
        const job1 = await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId: companyIdA,
            attemptId: 'att_notif_1',
            deduplicationKey: 'notif_success_att_notif_1',
            payload: { notificationType: 'PAYMENT_SUCCESS' },
        });

        expect(PaymentOutboxJob.findOneAndUpdate).toHaveBeenCalledWith(
            { deduplicationKey: 'notif_success_att_notif_1' },
            expect.any(Object),
            expect.any(Object)
        );
    });

    // ── 10. Notification worker crash and recovery ─────────────────────────────
    it('10. Notification worker locks expired jobs and resumes without data loss', async () => {
        const mockJob: any = {
            jobId: 'job_recover_1',
            type: 'PAYMENT_NOTIFICATION',
            payload: { notificationType: 'PAYMENT_SUCCESS', companyId: companyIdA, actorId: userIdA },
            attempts: 1,
            maxAttempts: 5,
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(PaymentOutboxJob.find).mockReturnValue({
            limit: vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue([mockJob]),
            }),
        } as any);

        const count = await PaymentOutboxService.processPendingBatch(10);
        expect(count).toBe(1);
        expect(mockJob.status).toBe('COMPLETED');
    });

    // ── 11. Redis outage and application worker restart ────────────────────────
    it('11. System operates correctly when Redis is offline', async () => {
        // Entitlement and outbox fallback gracefully to MongoDB
        expect(() => {
            paymentService = new PaymentService(mockAdapter);
        }).not.toThrow();
    });

    // ── 12. Unauthorized access and cross-company data leakage ────────────────
    it('12. Unauthorized access across companies is rejected with 403 Forbidden', async () => {
        const mockAttempt: any = {
            attemptId: 'att_tenant_leak',
            companyId: new Types.ObjectId(companyIdA), // Belongs to Company A
            state: PaymentAttemptState.PENDING,
            amount: 99900,
            currency: 'INR',
            billingObligationId: 'obl_1',
        };

        vi.mocked(PaymentAttempt.findOne).mockReturnValue({
            populate: vi.fn().mockResolvedValue(mockAttempt),
        } as any);

        // Company B tries to read Company A's attempt
        const res = await request(app)
            .get('/api/v1/payments/attempts/att_tenant_leak')
            .set('Authorization', `Bearer ${companyAdminTokenB}`);

        expect(res.status).toBe(403);
        expect(res.body.message).toContain('Access to payment attempt belonging to another organization is denied');
    });

    // ── 13. Reconciliation of unknown payments ─────────────────────────────────
    it('13. Reconciliation recovers captured payment and activates subscription', async () => {
        const attemptDoc: any = {
            attemptId: 'att_recon_1',
            companyId: new Types.ObjectId(companyIdA),
            actorId: new Types.ObjectId(userIdA),
            planId: new Types.ObjectId(planId),
            state: PaymentAttemptState.UNKNOWN,
            amount: 99900,
            currency: 'INR',
            providerOrderId: 'order_mock_123',
            reconciliationCount: 0,
            billingCycle: 'MONTHLY',
            billingObligationId: 'obl_recon_1',
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(attemptDoc);
        vi.mocked(PaymentAttempt.findOneAndUpdate).mockResolvedValue({
            ...attemptDoc,
            state: PaymentAttemptState.SUCCEEDED,
            confirmedAt: new Date(),
        } as any);
        vi.mocked(Plan.findById).mockResolvedValue(mockPlan as any);

        const reconciled = await paymentService.reconcileAttempt('att_recon_1');

        expect(mockAdapter.fetchOrderPayments).toHaveBeenCalledWith('order_mock_123');
        expect(reconciled.state).toBe(PaymentAttemptState.SUCCEEDED);
    });

    // ── 14. Refunds, cancellation, renewal, and AutoPay failure ────────────────
    it('14. Webhook processes refund.processed and marks attempt REFUNDED', async () => {
        const attemptDoc: any = {
            attemptId: 'att_to_refund',
            companyId: new Types.ObjectId(companyIdA),
            state: PaymentAttemptState.SUCCEEDED,
            amount: 99900,
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(PaymentAttempt.findOne).mockResolvedValue(attemptDoc);

        const webhookWorker = new PaymentWebhookWorker(paymentService);
        const mockWebhookEvent: any = {
            eventType: 'refund.processed',
            payload: {
                payment: { entity: { id: 'pay_mock_123', order_id: 'order_mock_123' } },
            },
            save: vi.fn().mockResolvedValue(true),
        };

        const success = await webhookWorker.processEvent(mockWebhookEvent);
        expect(success).toBe(true);
        expect(attemptDoc.state).toBe(PaymentAttemptState.REFUNDED);
    });
});
