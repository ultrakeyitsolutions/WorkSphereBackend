import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { PaymentAttempt } from '../src/modules/payments/models/payment-attempt.model';
import { PaymentAttemptState } from '../src/modules/payments/models/payment-attempt.types';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import companyBillingRoutes from '../src/modules/companyadmin/billing/company-billing.routes';
import paymentRoutes from '../src/modules/payments/payment.routes';
import { errorHandler } from '../src/middleware/error.middleware';
import { PaymentWebhookWorker } from '../src/modules/payments/workers/payment-webhook.worker';

const {
    mockCreateOrder,
    mockVerifyPaymentSignature,
    mockVerifyWebhookSignature,
    mockFetchPayment,
} = vi.hoisted(() => ({
    mockCreateOrder: vi.fn(),
    mockVerifyPaymentSignature: vi.fn(),
    mockVerifyWebhookSignature: vi.fn(),
    mockFetchPayment: vi.fn(),
}));

vi.mock('../src/modules/payments/models/payment-attempt.model', () => ({
    PaymentAttempt: {
        create: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        find: vi.fn(),
        countDocuments: vi.fn(),
        deleteOne: vi.fn(),
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
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription-event.model', () => ({
    SubscriptionEvent: {
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn(),
    },
}));

vi.mock('../src/services/subscription-entitlement-sync.service', () => ({
    SubscriptionEntitlementSyncService: {
        sync: vi.fn().mockResolvedValue(true),
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

vi.mock('../src/modules/payments/providers/razorpay.adapter', () => {
    return {
        RazorpayAdapter: class {
            readonly providerName = 'RAZORPAY';
            readonly environment = 'TEST';
            createOrder = mockCreateOrder;
            verifyPaymentSignature = mockVerifyPaymentSignature;
            verifyWebhookSignature = mockVerifyWebhookSignature;
            fetchPayment = mockFetchPayment;
            fetchOrderPayments = vi.fn();
            refundPayment = vi.fn();
        },
    };
});

describe('Razorpay Subscription Payment Amount Parity & Proration Integrity Suite', () => {
    let app: express.Express;
    let paymentService: PaymentService;

    const companyId = new Types.ObjectId().toString();
    const actorId = new Types.ObjectId().toString();

    const companyAdminToken = generateAccessToken({
        userId: actorId,
        email: 'admin@company.com',
        role: 'COMPANY_ADMIN',
        companyId,
    });

    // SuperAdmin Subscription Plans
    const monthlyPlanId = '6a969f32384ba0f020d562fa';
    const semiAnnualPlanId = '6a96a0b4384ba0f020d562ff';
    const annualPlanId = '6a96a115384ba0f020d56309';

    const monthlyPlan = {
        _id: new Types.ObjectId(monthlyPlanId),
        name: 'Monthly',
        code: 'MONTH',
        price: 4020,
        billingCycle: 'MONTHLY',
        currency: 'INR',
        isActive: true,
        isArchived: false,
    };

    const semiAnnualPlan = {
        _id: new Types.ObjectId(semiAnnualPlanId),
        name: 'Semi Annual',
        code: 'SEMI',
        price: 6000,
        billingCycle: 'SEMI_ANNUAL',
        currency: 'INR',
        isActive: true,
        isArchived: false,
    };

    const annualPlan = {
        _id: new Types.ObjectId(annualPlanId),
        name: 'Annual',
        code: 'YEALY',
        price: 10000,
        billingCycle: 'YEARLY',
        currency: 'INR',
        isActive: true,
        isArchived: false,
    };

    const plansMap: Record<string, any> = {
        [monthlyPlanId]: monthlyPlan,
        [semiAnnualPlanId]: semiAnnualPlan,
        [annualPlanId]: annualPlan,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        paymentService = new PaymentService();

        app = express();
        app.use(express.json());
        app.use('/api/v1/company/billing', companyBillingRoutes);
        app.use('/api/v1/payments', paymentRoutes);
        app.use(errorHandler);

        // Company mock
        vi.mocked(Company.findById).mockResolvedValue({
            _id: new Types.ObjectId(companyId),
            name: 'Acme Test Corp',
            status: 'ACTIVE',
        } as any);

        // Plan mock
        vi.mocked(Plan.findById).mockImplementation(async (id: any) => {
            const plan = plansMap[id?.toString()];
            return plan ? { ...plan } : null;
        });

        vi.mocked(Plan.find).mockReturnValue({
            lean: vi.fn().mockResolvedValue([monthlyPlan, semiAnnualPlan, annualPlan]),
        } as any);

        // Mock Razorpay Order Creation
        mockCreateOrder.mockImplementation(async (opts: any) => ({
            providerOrderId: `order_${Date.now()}`,
            amount: opts.amount,
            currency: opts.currency,
            status: 'created',
            raw: { id: `order_${Date.now()}`, amount: opts.amount },
        }));
    });

    describe('1. Plan Pricing for New Subscriptions (No Existing Plan Credit)', () => {
        it('charges exact Monthly plan price (₹4,020 -> 402,000 paise) for new subscription', async () => {
            vi.mocked(Subscription.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

            let createdAttempt: any;
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => {
                createdAttempt = { ...doc, save: vi.fn().mockResolvedValue(doc) };
                return createdAttempt;
            });

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_new_monthly_1')
                .send({ planId: monthlyPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            expect(res.body.data.amount).toBe(402000);
            expect(res.body.data.formattedAmount).toBe('4020.00');
            expect(mockCreateOrder).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 402000, currency: 'INR' })
            );
        });

        it('charges exact Semi Annual plan price (₹6,000 -> 600,000 paise) for new subscription', async () => {
            vi.mocked(Subscription.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_new_semi_1')
                .send({ planId: semiAnnualPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            expect(res.body.data.amount).toBe(600000);
            expect(res.body.data.formattedAmount).toBe('6000.00');
            expect(mockCreateOrder).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 600000, currency: 'INR' })
            );
        });

        it('charges exact Annual plan price (₹10,000 -> 1,000,000 paise) for new subscription', async () => {
            vi.mocked(Subscription.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);

            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_new_annual_1')
                .send({ planId: annualPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            expect(res.body.data.amount).toBe(1000000);
            expect(res.body.data.formattedAmount).toBe('10000.00');
            expect(mockCreateOrder).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 1000000, currency: 'INR' })
            );
        });
    });

    describe('2. Proration Protection for Complimentary and Trial Subscriptions', () => {
        it('never applies proration credit when existing subscription is COMPLIMENTARY (charges full ₹10,000, not ₹6,010.99)', async () => {
            // Company has an active Monthly plan granted complimentary by SuperAdmin for free
            const oneYearAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
            const oneYearLater = new Date(Date.now() + 362 * 24 * 60 * 60 * 1000);

            vi.mocked(Subscription.findOne).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: true,
                complimentaryReason: 'Free onboarding gift',
                pricingOverride: 0,
                currentPeriodStart: oneYearAgo,
                currentPeriodEnd: oneYearLater,
            } as any);

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_upgrade_from_complimentary')
                .send({ planId: annualPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            // Must charge the full ₹10,000 (1,000,000 paise) — NO unearned ₹3,989.01 credit!
            expect(res.body.data.amount).toBe(1000000);
            expect(res.body.data.formattedAmount).toBe('10000.00');
            expect(mockCreateOrder).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 1000000, currency: 'INR' })
            );
        });

        it('reports zero credit and full payable price in getTenantBillingOverview for complimentary plan', async () => {
            const oneYearAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
            const oneYearLater = new Date(Date.now() + 362 * 24 * 60 * 60 * 1000);

            vi.mocked(Subscription.findOne).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: new Types.ObjectId(),
                            companyId: new Types.ObjectId(companyId),
                            planId: monthlyPlan,
                            status: SubscriptionStatus.ACTIVE,
                            isComplimentary: true,
                            pricingOverride: 0,
                            currentPeriodStart: oneYearAgo,
                            currentPeriodEnd: oneYearLater,
                        }),
                    }),
                }),
            } as any);

            vi.mocked(PaymentAttempt.find).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            } as any);

            const res = await request(app)
                .get('/api/v1/company/billing/overview')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            const annualUpgrade = res.body.data.availableUpgrades.find((u: any) => u.name === 'Annual');
            expect(annualUpgrade).toBeDefined();
            // Prorated credit must be 0, and estimated payable must be full ₹10,000
            expect(annualUpgrade.proratedCredit).toBe(0);
            expect(annualUpgrade.estimatedPayable).toBe(10000);
            expect(annualUpgrade.savingsFromCurrentPlan).toBe(0);
            expect(annualUpgrade.proratedUpgradePrice).toBe(10000);
        });
    });

    describe('3. Legitimate Paid Proration & Upgrades', () => {
        it('correctly calculates remaining-period credit from a paid subscription', async () => {
            // Paid monthly plan: 30 days total, exactly 15 days remaining (50% remaining ratio)
            const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
            const fifteenDaysLater = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

            vi.mocked(Subscription.findOne).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: fifteenDaysAgo,
                currentPeriodEnd: fifteenDaysLater,
            } as any);

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_legit_upgrade_1')
                .send({ planId: annualPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            // 50% of ₹4,020 is ₹2,010.00 credit.
            // Net payable: 10,000 - 2,010 = ₹7,990.00 = 799,000 paise
            expect(res.body.data.amount).toBe(799000);
            expect(res.body.data.formattedAmount).toBe('7990.00');
            expect(mockCreateOrder).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 799000, currency: 'INR' })
            );
        });

        it('bypasses proration when billingPolicy is STANDARD or FULL_PRICE', async () => {
            const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
            const fifteenDaysLater = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

            vi.mocked(Subscription.findOne).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: fifteenDaysAgo,
                currentPeriodEnd: fifteenDaysLater,
            } as any);

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_standard_policy_1')
                .send({ planId: annualPlanId, billingPolicy: 'STANDARD' });

            expect(res.status).toBe(201);
            // Must charge full ₹10,000 without proration deduction
            expect(res.body.data.amount).toBe(1000000);
            expect(res.body.data.formattedAmount).toBe('10000.00');
            expect(res.body.data.billingPolicy).toBe('FULL_PRICE');
        });

        it('charges full price for renewing the same plan (not a mid-cycle change)', async () => {
            const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
            const fifteenDaysLater = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

            vi.mocked(Subscription.findOne).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: fifteenDaysAgo,
                currentPeriodEnd: fifteenDaysLater,
            } as any);

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_same_plan_renewal')
                .send({ planId: monthlyPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            expect(res.body.data.amount).toBe(402000);
            expect(res.body.data.formattedAmount).toBe('4020.00');
        });
    });

    describe('4. Downgrades and Retries', () => {
        it('handles downgrade from Annual to Monthly with credit exceeding price as zero-cost upgrade', async () => {
            // Active Annual subscription with 10 months remaining (~₹8,333 credit > ₹4,020 Monthly)
            const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            const tenMonthsLater = new Date(Date.now() + 305 * 24 * 60 * 60 * 1000);

            const subDoc = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(annualPlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: twoMonthsAgo,
                currentPeriodEnd: tenMonthsLater,
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(Subscription.findOne).mockResolvedValue(subDoc as any);

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(null);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));
            vi.mocked(PaymentAttempt.findOneAndUpdate).mockResolvedValue({
                _id: new Types.ObjectId(),
                attemptId: 'att_downgrade_zero',
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(monthlyPlanId),
                actorId: new Types.ObjectId(actorId),
                billingObligationId: 'obl_downgrade',
                providerPaymentId: 'zero_charge_123',
                save: vi.fn().mockResolvedValue(true),
            } as any);

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_downgrade_zero_cost')
                .send({ planId: monthlyPlanId, billingPolicy: 'PRORATED' });

            expect(res.status).toBe(201);
            // Amount is 0 because remaining credit covered entire monthly plan
            expect(res.body.data.amount).toBe(0);
            expect(res.body.data.status).toBe(PaymentAttemptState.SUCCEEDED);
            // Razorpay order creation should NOT be invoked for zero-cost upgrade
            expect(mockCreateOrder).not.toHaveBeenCalled();
        });

        it('replays identical attempt idempotently without recalculating or creating duplicate orders', async () => {
            const existingAttempt = {
                _id: new Types.ObjectId(),
                attemptId: 'att_replay_123',
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(annualPlanId),
                amount: 1000000,
                currency: 'INR',
                state: PaymentAttemptState.PENDING,
                providerOrderId: 'order_existing_123',
                idempotencyKey: 'idem_replay_test',
                requestFingerprint: PaymentService.computeRequestFingerprint({
                    companyId,
                    planId: annualPlanId,
                    billingCycle: 'YEARLY',
                    amount: 1000000,
                    currency: 'INR',
                    billingObligationId: `obl_${companyId}_${annualPlanId}_YEARLY_${new Date().toISOString().slice(0, 7)}`,
                }),
                billingPolicy: 'FULL_PRICE',
                isAutoPay: false,
            };

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(existingAttempt as any);

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_replay_test')
                .send({ planId: annualPlanId, billingPolicy: 'FULL_PRICE' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('idempotently');
            expect(res.body.data.amount).toBe(1000000);
            expect(res.body.data.providerOrderId).toBe('order_existing_123');
            expect(mockCreateOrder).not.toHaveBeenCalled();
        });

        it('cleans up failed attempt and allows fresh retry with the same idempotency key', async () => {
            const failedAttempt = {
                _id: new Types.ObjectId(),
                attemptId: 'att_failed_123',
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(annualPlanId),
                state: PaymentAttemptState.FAILED,
                idempotencyKey: 'idem_retry_test',
            };

            vi.mocked(PaymentAttempt.findOne)
                .mockResolvedValueOnce(failedAttempt as any) // Check 1: idempotency key lookup
                .mockResolvedValueOnce(null); // Check 2: active obligation guard

            vi.mocked(PaymentAttempt.deleteOne).mockResolvedValue({ deletedCount: 1 } as any);
            vi.mocked(PaymentAttempt.create).mockImplementation(async (doc: any) => ({
                ...doc,
                save: vi.fn().mockResolvedValue(doc),
            }));

            const res = await request(app)
                .post('/api/v1/company/billing/upgrade')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .set('Idempotency-Key', 'idem_retry_test')
                .send({ planId: annualPlanId, billingPolicy: 'FULL_PRICE' });

            expect(res.status).toBe(201);
            expect(vi.mocked(PaymentAttempt.deleteOne)).toHaveBeenCalledWith({ _id: failedAttempt._id });
            expect(mockCreateOrder).toHaveBeenCalledTimes(1);
        });
    });

    describe('5. Payment Verification & Webhook Amount Validation', () => {
        it('rejects payment verification when gateway amount does not match attempt amount', async () => {
            const attempt = {
                _id: new Types.ObjectId(),
                attemptId: 'att_verify_mismatch',
                companyId: new Types.ObjectId(companyId),
                amount: 1000000, // Expected: 1,000,000 paise (₹10,000)
                state: PaymentAttemptState.PENDING,
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(PaymentAttempt.findOne).mockReturnValue({
                populate: vi.fn().mockResolvedValue(attempt),
            } as any);
            mockVerifyPaymentSignature.mockReturnValue(true);
            // Gateway returns captured payment for only 500,000 paise (₹5,000)
            mockFetchPayment.mockResolvedValue({
                id: 'pay_tampered_123',
                status: 'captured',
                amount: 500000,
            });

            await expect(
                paymentService.verifyPayment('att_verify_mismatch', companyId, {
                    providerPaymentId: 'pay_tampered_123',
                    providerOrderId: 'order_123',
                    providerSignature: 'sig_valid',
                })
            ).rejects.toThrow('Payment amount does not match the order amount');

            expect(attempt.state).toBe(PaymentAttemptState.FAILED);
            expect(attempt.errorCode).toBe('AMOUNT_MISMATCH');
        });

        it('rejects webhook event if webhook amount does not match attempt amount', async () => {
            const webhookWorker = new PaymentWebhookWorker();

            const attempt = {
                _id: new Types.ObjectId(),
                attemptId: 'att_webhook_test',
                amount: 1000000, // Expected: 1,000,000 paise
                state: PaymentAttemptState.PENDING,
            };

            vi.mocked(PaymentAttempt.findOne).mockResolvedValue(attempt as any);

            const webhookEventDoc = {
                _id: new Types.ObjectId(),
                eventType: 'payment.captured',
                payload: {
                    payload: {
                        payment: {
                            entity: {
                                id: 'pay_webhook_mismatch',
                                order_id: 'order_wh_123',
                                amount: 601099, // Mismatch: 601,099 paise instead of 1,000,000
                                status: 'captured',
                            },
                        },
                    },
                },
                status: 'RECEIVED',
                processingError: null as any,
                save: vi.fn().mockResolvedValue(true),
            };

            const result = await webhookWorker.processEvent(webhookEventDoc as any);
            expect(result).toBe(true);
            expect(webhookEventDoc.status).toBe('FAILED');
            expect(webhookEventDoc.processingError).toContain('Webhook amount mismatch');
        });
    });

    describe('6. Payment History Formatting Integrity', () => {
        it('formats amounts correctly in payment history matching Razorpay order amount', async () => {
            const sampleAttempts = [
                {
                    attemptId: 'att_hist_1',
                    companyId: new Types.ObjectId(companyId),
                    planId: monthlyPlan,
                    planSnapshot: { name: 'Monthly', price: 4020, billingCycle: 'MONTHLY' },
                    billingCycle: 'MONTHLY',
                    amount: 402000,
                    currency: 'INR',
                    state: PaymentAttemptState.SUCCEEDED,
                    createdAt: new Date(),
                },
                {
                    attemptId: 'att_hist_2',
                    companyId: new Types.ObjectId(companyId),
                    planId: annualPlan,
                    planSnapshot: { name: 'Annual', price: 10000, billingCycle: 'YEARLY' },
                    billingCycle: 'YEARLY',
                    amount: 1000000,
                    currency: 'INR',
                    state: PaymentAttemptState.SUCCEEDED,
                    createdAt: new Date(),
                },
            ];

            vi.mocked(PaymentAttempt.find).mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        skip: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                lean: vi.fn().mockResolvedValue(sampleAttempts),
                            }),
                        }),
                    }),
                }),
            } as any);
            vi.mocked(PaymentAttempt.countDocuments).mockResolvedValue(2);

            const res = await request(app)
                .get('/api/v1/company/billing/payments')
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(2);
            expect(res.body.data.items[0].amount).toBe(402000);
            expect(res.body.data.items[0].formattedAmount).toBe('4020.00');
            expect(res.body.data.items[1].amount).toBe(1000000);
            expect(res.body.data.items[1].formattedAmount).toBe('10000.00');
        });
    });
});
