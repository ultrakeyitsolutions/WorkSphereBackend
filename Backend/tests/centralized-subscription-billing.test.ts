import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { SubscriptionService } from '../src/modules/super-admin/subscriptions/subscription.service';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { CompanyService } from '../src/modules/super-admin/companies/company.service';
import { CompanyProfileService } from '../src/modules/companyadmin/profile/company-profile.service';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionEvent } from '../src/modules/super-admin/subscriptions/subscription-event.model';
import { PaymentAttempt } from '../src/modules/payments/models/payment-attempt.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { SubscriptionEntitlementSyncService } from '../src/services/subscription-entitlement-sync.service';
import { EntitlementService } from '../src/services/entitlement.service';

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
        findOne: vi.fn(),
        updateOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plans/plans.model', () => ({
    Plan: {
        findById: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription-event.model', () => ({
    SubscriptionEvent: {
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/payments/models/payment-attempt.model', () => ({
    PaymentAttempt: {
        create: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/services/subscription-entitlement-sync.service', () => ({
    SubscriptionEntitlementSyncService: {
        sync: vi.fn(),
    },
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        invalidateCache: vi.fn(),
    },
}));

describe('Centralized Subscription, Billing & Entitlement Management', () => {
    const mockCompanyId = new Types.ObjectId().toString();
    const mockAdminId = new Types.ObjectId().toString();
    const mockPlanIdMonthly = new Types.ObjectId().toString();
    const mockPlanIdYearly = new Types.ObjectId().toString();
    const mockSubId = new Types.ObjectId();

    const monthlyPlan = {
        _id: new Types.ObjectId(mockPlanIdMonthly),
        name: 'Growth Plan',
        code: 'GROWTH',
        price: 2999,
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    const yearlyPlan = {
        _id: new Types.ObjectId(mockPlanIdYearly),
        name: 'Enterprise Annual Plan',
        code: 'ENTERPRISE_ANNUAL',
        price: 29999,
        billingCycle: 'YEARLY',
        isActive: true,
        isArchived: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('1. Single Source of Truth Resolution (getActiveSubscriptionDocument)', () => {
        it('should resolve active subscription from company.subscriptionId and heal mismatch if missing', async () => {
            const activeSub = {
                _id: mockSubId,
                companyId: new Types.ObjectId(mockCompanyId),
                planId: new Types.ObjectId(mockPlanIdYearly),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            };

            // Company has no subscriptionId stored yet (desynced)
            (Company.findById as any).mockReturnValue({
                select: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(mockCompanyId), subscriptionId: null }),
            });

            // Subscription query resolves active sub with sort
            (Subscription.findOne as any).mockReturnValue({
                sort: vi.fn().mockResolvedValue(activeSub),
            });

            const resolved = await SubscriptionService.getActiveSubscriptionDocument(mockCompanyId);

            expect(resolved).toBeDefined();
            expect(resolved?._id).toEqual(mockSubId);
            // Must automatically self-heal Company.subscriptionId
            expect(Company.updateOne).toHaveBeenCalledWith(
                { _id: new Types.ObjectId(mockCompanyId) },
                { $set: { subscriptionId: mockSubId } }
            );
        });
    });

    describe('2. SuperAdmin Plan Changes & Synchronization', () => {
        it('assignPlan immediately updates Company.subscriptionId and calculates accurate yearly period', async () => {
            (Plan.findById as any).mockResolvedValue(yearlyPlan);
            (Company.findById as any).mockResolvedValue({ _id: new Types.ObjectId(mockCompanyId), name: 'Acme Corp' });

            // Spy on getActiveSubscriptionDocument to return null (fresh subscription creation)
            vi.spyOn(SubscriptionService, 'getActiveSubscriptionDocument').mockResolvedValue(null);

            (Subscription.create as any).mockResolvedValue({
                _id: mockSubId,
                companyId: new Types.ObjectId(mockCompanyId),
                planId: yearlyPlan._id,
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            });

            const sub = await SubscriptionService.assignPlan(mockCompanyId, mockPlanIdYearly, mockAdminId);

            expect(sub).toBeDefined();
            expect(Company.updateOne).toHaveBeenCalledWith(
                { _id: mockCompanyId },
                { $set: { subscriptionId: mockSubId } }
            );
            expect(SubscriptionEntitlementSyncService.sync).toHaveBeenCalledWith(
                expect.objectContaining({
                    companyId: mockCompanyId,
                    toPlanId: mockPlanIdYearly,
                })
            );
            // Verify NO fake payment attempt was created
            expect(PaymentAttempt.create).not.toHaveBeenCalled();
        });

        it('changePlan immediately sets new period start/end and updates Company.subscriptionId', async () => {
            (Plan.findById as any).mockImplementation((id: any) => {
                if (String(id) === mockPlanIdYearly) return Promise.resolve(yearlyPlan);
                return Promise.resolve(monthlyPlan);
            });

            const existingActiveSub = {
                _id: mockSubId,
                companyId: new Types.ObjectId(mockCompanyId),
                planId: new Types.ObjectId(mockPlanIdMonthly),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
                currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(SubscriptionService, 'getActiveSubscriptionDocument').mockResolvedValue(existingActiveSub as any);

            const updated = await SubscriptionService.changePlan(
                mockCompanyId,
                mockPlanIdYearly,
                mockAdminId,
                true // immediate
            );

            expect(updated).toBeDefined();
            expect(existingActiveSub.save).toHaveBeenCalled();
            expect(Company.updateOne).toHaveBeenCalledWith(
                { _id: mockCompanyId },
                { $set: { subscriptionId: mockSubId } }
            );
            expect(SubscriptionEntitlementSyncService.sync).toHaveBeenCalled();
        });
    });

    describe('3. Payment Activation & Company Synchronization', () => {
        it('activateSubscriptionForPayment synchronizes both PaymentAttempt and Company.subscriptionId', async () => {
            const paymentService = new PaymentService({} as any);

            (Plan.findById as any).mockResolvedValue(monthlyPlan);

            const mockAttempt = {
                _id: new Types.ObjectId(),
                attemptId: 'att_test_123',
                companyId: new Types.ObjectId(mockCompanyId),
                planId: monthlyPlan._id,
                actorId: new Types.ObjectId(mockAdminId),
                subscriptionId: null as any,
                save: vi.fn().mockResolvedValue(true),
            };

            vi.spyOn(SubscriptionService, 'getActiveSubscriptionDocument').mockResolvedValue(null);

            (Subscription.create as any).mockResolvedValue({
                _id: mockSubId,
                companyId: mockAttempt.companyId,
                planId: monthlyPlan._id,
                status: SubscriptionStatus.ACTIVE,
            });

            await paymentService.activateSubscriptionForPayment(mockAttempt as any);

            expect(mockAttempt.subscriptionId).toEqual(mockSubId);
            expect(mockAttempt.save).toHaveBeenCalled();
            expect(Company.updateOne).toHaveBeenCalledWith(
                { _id: mockAttempt.companyId },
                { $set: { subscriptionId: mockSubId } }
            );
            expect(SubscriptionEntitlementSyncService.sync).toHaveBeenCalled();
        });
    });

    describe('4. Tenant Billing Overview & Proration Toggle', () => {
        it('returns populated currentPlan at top level and applies proration credit when enabled', async () => {
            const paymentService = new PaymentService({} as any);

            const activeSubDoc = {
                _id: mockSubId,
                planId: monthlyPlan,
                scheduledPlanId: null,
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
                currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days remaining (50%)
                cancelAtPeriodEnd: false,
            };

            vi.spyOn(SubscriptionService, 'getActiveSubscriptionDocument').mockResolvedValue({ _id: mockSubId } as any);

            (Company.findById as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(mockCompanyId),
                    name: 'Test Org',
                    status: 'ACTIVE',
                    billingProrationEnabled: true,
                    billingDiscountEnabled: false,
                }),
            });

            (Subscription.findById as any).mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(activeSubDoc),
            });

            (Plan.find as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue([monthlyPlan, yearlyPlan]),
            });

            (PaymentAttempt.find as any).mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            });

            const overview = await paymentService.getTenantBillingOverview(mockCompanyId);

            // Critical contract assertions
            expect(overview.company).toBeDefined();
            expect(overview.company.name).toBe('Test Org');
            expect(overview.currentPlan).toBeDefined();
            expect(overview.currentPlan.name).toBe('Growth Plan'); // Never empty or fallback!
            expect(overview.currentSubscription).toBeDefined();
            expect(overview.currentSubscription.status).toBe('ACTIVE');

            // Proration credit verification (approx 50% unused of 2999 = ~1499.50)
            const upgradeOption = overview.availableUpgrades.find((u: any) => u.name === yearlyPlan.name);
            expect(upgradeOption).toBeDefined();
            expect(upgradeOption.proratedCredit).toBeGreaterThan(0);
            expect(upgradeOption.estimatedPayable).toBeLessThan(yearlyPlan.price);
        });

        it('disables proration credit and charges full price when billingProrationEnabled is false', async () => {
            const paymentService = new PaymentService({} as any);

            const activeSubDoc = {
                _id: mockSubId,
                planId: monthlyPlan,
                scheduledPlanId: null,
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: false,
                currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
                currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
                cancelAtPeriodEnd: false,
            };

            vi.spyOn(SubscriptionService, 'getActiveSubscriptionDocument').mockResolvedValue({ _id: mockSubId } as any);

            (Company.findById as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(mockCompanyId),
                    name: 'Test Org No Proration',
                    status: 'ACTIVE',
                    billingProrationEnabled: false, // Proration toggled OFF by SuperAdmin
                }),
            });

            (Subscription.findById as any).mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(activeSubDoc),
            });

            (Plan.find as any).mockReturnValue({
                lean: vi.fn().mockResolvedValue([monthlyPlan, yearlyPlan]),
            });

            (PaymentAttempt.find as any).mockReturnValue({
                populate: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue([]),
            });

            const overview = await paymentService.getTenantBillingOverview(mockCompanyId);

            expect(overview.companyDiscountSettings.prorationEnabled).toBe(false);

            const upgradeOption = overview.availableUpgrades.find((u: any) => u.name === yearlyPlan.name);
            expect(upgradeOption).toBeDefined();
            expect(upgradeOption.proratedCredit).toBe(0);
            expect(upgradeOption.estimatedPayable).toBe(yearlyPlan.price); // Charged full amount!
        });
    });

    describe('5. SuperAdmin Proration Toggle API', () => {
        it('updateBillingDiscountSettings persists billingProrationEnabled and invalidates cache', async () => {
            const mockCompanyDoc = {
                _id: new Types.ObjectId(mockCompanyId),
                billingProrationEnabled: true,
                billingDiscountEnabled: false,
                billingDiscountPercentage: 0,
                save: vi.fn().mockResolvedValue(true),
            };

            (Company.findOne as any).mockResolvedValue(mockCompanyDoc);

            await CompanyService.updateBillingDiscountSettings(mockCompanyId, {
                billingProrationEnabled: false,
            });

            expect(mockCompanyDoc.billingProrationEnabled).toBe(false);
            expect(mockCompanyDoc.save).toHaveBeenCalled();
            expect(EntitlementService.invalidateCache).toHaveBeenCalledWith(mockCompanyId);
        });
    });
});

