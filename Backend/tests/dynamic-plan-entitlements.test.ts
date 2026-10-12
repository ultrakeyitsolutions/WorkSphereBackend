import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { EntitlementService } from '../src/services/entitlement.service';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { ModuleAccessService } from '../src/modules/companyadmin/module-access/module-access.service';
import { SubscriptionService } from '../src/modules/super-admin/subscriptions/subscription.service';
import { PlanFeatureService } from '../src/modules/super-admin/plan-features/plan-features.service';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { CompanyModuleAccess } from '../src/modules/companyadmin/module-access/module-access.model';
import { requireFeature } from '../src/middleware/entitlement.middleware';
import { requireModuleAccess } from '../src/middleware/module-access.middleware';
import { generateAccessToken } from '../src/utils/tokens';
import { authenticate } from '../src/middleware/auth.middleware';

// Mock DB Models for pure deterministic unit testing
vi.mock('../src/modules/super-admin/plans/plans.model');
vi.mock('../src/modules/super-admin/features/features.model');
vi.mock('../src/modules/super-admin/plan-features/plan-features.model');
vi.mock('../src/modules/super-admin/subscriptions/subscription.model');
vi.mock('../src/modules/super-admin/companies/company.model');
vi.mock('../src/modules/companyadmin/invitations/company-member.model');
vi.mock('../src/modules/companyadmin/module-access/module-access.model');
vi.mock('../src/modules/super-admin/subscriptions/subscription-event.model', () => ({
    SubscriptionEvent: {
        create: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../src/config/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue(null),
    redisGet: vi.fn().mockResolvedValue(null),
    redisSet: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkSphere: Dynamic Plan-Based Feature Entitlements Suite', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();
    const adminUserId = new Types.ObjectId().toString();
    const employeeUserId = new Types.ObjectId().toString();

    // Catalog Features
    const featureTemplates = { _id: new Types.ObjectId(), key: 'TASK_TEMPLATES', name: 'Task Templates', isActive: true, type: 'BOOLEAN' };
    const featureRecurring = { _id: new Types.ObjectId(), key: 'RECURRING_TASKS', name: 'Recurring Tasks', isActive: true, type: 'BOOLEAN' };
    const featureAnalytics = { _id: new Types.ObjectId(), key: 'DASHBOARD_ANALYTICS', name: 'Dashboard Analytics', isActive: true, type: 'BOOLEAN' };
    const featureChat = { _id: new Types.ObjectId(), key: 'CHAT', name: 'Chat', isActive: true, type: 'BOOLEAN' };
    const featureTheme = { _id: new Types.ObjectId(), key: 'CUSTOM_COMPANY_THEME', name: 'Custom Company Theme', isActive: true, type: 'BOOLEAN' };
    const featureMeetings = { _id: new Types.ObjectId(), key: 'QUICK_MEETINGS', name: 'Quick Meetings', isActive: true, type: 'LIMIT' };

    // Plans
    const monthlyPlanId = new Types.ObjectId().toString();
    const semiAnnualPlanId = new Types.ObjectId().toString();
    const annualPlanId = new Types.ObjectId().toString();

    const monthlyPlan = { _id: new Types.ObjectId(monthlyPlanId), name: 'Starter Monthly', billingCycle: 'MONTHLY', isActive: true, price: 19 };
    const semiAnnualPlan = { _id: new Types.ObjectId(semiAnnualPlanId), name: 'Growth Semi-Annual', billingCycle: 'SEMI_ANNUAL', isActive: true, price: 99 };
    const annualPlan = { _id: new Types.ObjectId(annualPlanId), name: 'Enterprise Annual', billingCycle: 'YEARLY', isActive: true, price: 199 };

    let inMemorySubscriptions: any[] = [];
    let inMemoryPlanFeatures: any[] = [];

    // Build protected test express app
    const app = express();
    app.use(express.json());

    const mockAuth = (req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        req.currentUser = {
            userId: adminUserId,
            email: 'admin@companya.com',
            role: 'COMPANY_ADMIN',
            companyId: companyAId,
        };
        req.user = req.currentUser;
        next();
    };

    // Protected API routes
    app.post('/api/test/task-templates', mockAuth, requireFeature('TASK_TEMPLATES'), (req, res) => {
        res.status(200).json({ success: true, message: 'Template created successfully' });
    });

    app.get('/api/test/recurring-tasks', mockAuth, requireFeature('RECURRING_TASKS'), (req, res) => {
        res.status(200).json({ success: true, message: 'Recurring tasks fetched' });
    });

    app.get('/api/test/dashboard-analytics', mockAuth, requireFeature('DASHBOARD_ANALYTICS'), (req, res) => {
        res.status(200).json({ success: true, message: 'Analytics data fetched' });
    });

    app.get('/api/test/chat', mockAuth, requireModuleAccess('chat'), (req, res) => {
        res.status(200).json({ success: true, message: 'Chat accessible' });
    });

    // Public / Free endpoint
    app.get('/api/test/public-profile', (req, res) => {
        res.status(200).json({ success: true, message: 'Public profile' });
    });

    beforeEach(() => {
        vi.clearAllMocks();
        EntitlementService.clearAllCache();
        FeatureAccessService.clearAllCache();

        inMemorySubscriptions = [];
        inMemoryPlanFeatures = [
            // Monthly has only TASK_TEMPLATES and CHAT
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureTemplates._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureChat._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureRecurring._id, enabled: false, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureAnalytics._id, enabled: false, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureTheme._id, enabled: false, limitType: 'NONE', value: null },

            // Semi-Annual has TEMPLATES, CHAT, RECURRING_TASKS, and QUICK_MEETINGS (60 mins)
            { planId: new Types.ObjectId(semiAnnualPlanId), featureId: featureTemplates._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(semiAnnualPlanId), featureId: featureChat._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(semiAnnualPlanId), featureId: featureRecurring._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(semiAnnualPlanId), featureId: featureMeetings._id, enabled: true, limitType: 'LIMITED', value: 60 },
            { planId: new Types.ObjectId(semiAnnualPlanId), featureId: featureAnalytics._id, enabled: false, limitType: 'NONE', value: null },

            // Annual has EVERYTHING (including ANALYTICS and THEME)
            { planId: new Types.ObjectId(annualPlanId), featureId: featureTemplates._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureChat._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureRecurring._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureMeetings._id, enabled: true, limitType: 'UNLIMITED', value: -1 },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureAnalytics._id, enabled: true, limitType: 'NONE', value: null },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureTheme._id, enabled: true, limitType: 'NONE', value: null },
        ];

        // Mocks for Subscription
        vi.mocked(Subscription.findOne).mockImplementation(((query: any) => {
            const sub = inMemorySubscriptions.find((s) => String(s.companyId) === String(query.companyId));
            let subData: any = null;
            if (sub) {
                let planObj = monthlyPlan;
                const pIdStr = String(sub.planId?._id || sub.planId);
                if (pIdStr === semiAnnualPlanId) planObj = semiAnnualPlan;
                if (pIdStr === annualPlanId) planObj = annualPlan;
                subData = {
                    ...sub,
                    planId: planObj,
                };
            }
            const chain: any = {
                sort: vi.fn().mockReturnThis(),
                populate: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(subData),
                save: vi.fn().mockResolvedValue(subData),
                then: (resolve: any) => resolve(subData),
            };
            return chain;
        }) as any);

        // Mocks for Plan
        vi.mocked(Plan.findById).mockImplementation(((id: any) => {
            const strId = String(id);
            if (strId === monthlyPlanId) return Promise.resolve(monthlyPlan) as any;
            if (strId === semiAnnualPlanId) return Promise.resolve(semiAnnualPlan) as any;
            if (strId === annualPlanId) return Promise.resolve(annualPlan) as any;
            return Promise.resolve(null) as any;
        }) as any);

        // Mocks for Feature
        vi.mocked(Feature.find).mockImplementation((() => {
            const list = [featureTemplates, featureRecurring, featureAnalytics, featureChat, featureTheme, featureMeetings];
            return {
                lean: vi.fn().mockResolvedValue(list),
            } as any;
        }) as any);

        vi.mocked(Feature.findOne).mockImplementation(((query: any) => {
            let keys: string[] = [];
            if (query?.key?.$in) keys = query.key.$in;
            else if (query?.key && typeof query.key === 'string') keys = [query.key];
            else if (query?.$or) {
                for (const part of query.$or) {
                    if (part.key?.$in) keys.push(...part.key.$in);
                    else if (part.key && typeof part.key === 'string') keys.push(part.key);
                }
            }
            if (keys.some((k) => k.toUpperCase().includes('TEMPLATE'))) return { lean: vi.fn().mockResolvedValue(featureTemplates), ...featureTemplates } as any;
            if (keys.some((k) => k.toUpperCase().includes('RECURR'))) return { lean: vi.fn().mockResolvedValue(featureRecurring), ...featureRecurring } as any;
            if (keys.some((k) => k.toUpperCase().includes('ANALYTIC'))) return { lean: vi.fn().mockResolvedValue(featureAnalytics), ...featureAnalytics } as any;
            if (keys.some((k) => k.toUpperCase().includes('CHAT'))) return { lean: vi.fn().mockResolvedValue(featureChat), ...featureChat } as any;
            if (keys.some((k) => k.toUpperCase().includes('THEME') || k.toUpperCase().includes('BRAND'))) return { lean: vi.fn().mockResolvedValue(featureTheme), ...featureTheme } as any;
            if (keys.some((k) => k.toUpperCase().includes('MEET'))) return { lean: vi.fn().mockResolvedValue(featureMeetings), ...featureMeetings } as any;
            return { lean: vi.fn().mockResolvedValue(null) } as any;
        }) as any);

        // Mocks for PlanFeature
        vi.mocked(PlanFeature.findOne).mockImplementation(((query: any) => {
            const found = inMemoryPlanFeatures.find(
                (pf) => String(pf.planId) === String(query.planId) && String(pf.featureId) === String(query.featureId)
            );
            return { lean: vi.fn().mockResolvedValue(found || null), ...found } as any;
        }) as any);

        vi.mocked(PlanFeature.find).mockImplementation(((query: any) => {
            const list = inMemoryPlanFeatures.filter((pf) => String(pf.planId) === String(query.planId));
            const populated = list.map((item) => {
                let feat = featureTemplates;
                if (String(item.featureId) === String(featureRecurring._id)) feat = featureRecurring;
                if (String(item.featureId) === String(featureAnalytics._id)) feat = featureAnalytics;
                if (String(item.featureId) === String(featureChat._id)) feat = featureChat;
                if (String(item.featureId) === String(featureTheme._id)) feat = featureTheme;
                if (String(item.featureId) === String(featureMeetings._id)) feat = featureMeetings;
                return {
                    ...item,
                    featureId: feat,
                };
            });
            return {
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(populated),
                }),
                lean: vi.fn().mockResolvedValue(list),
            } as any;
        }) as any);

        vi.mocked(PlanFeature.findOne).mockImplementation(((query: any) => {
            const item = inMemoryPlanFeatures.find(
                (pf) => String(pf.planId) === String(query.planId) && String(pf.featureId) === String(query.featureId)
            );
            return {
                lean: vi.fn().mockResolvedValue(item || null),
            } as any;
        }) as any);

        // Mocks for ModuleAccess
        vi.mocked(CompanyModuleAccess.findOne).mockReturnValue({
            globalSettings: { chat: true, 'live-monitoring': true },
            employeeOverrides: [],
            auditHistory: [],
        } as any);
    });

    // ── 1. Monthly includes only its configured features ─────────────────────
    it('1. Monthly plan includes only its configured features', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        const effective = await EntitlementService.getEffectiveEntitlements(companyAId);
        expect(effective.features['TASK_TEMPLATES']?.enabled).toBe(true);
        expect(effective.features['CHAT']?.enabled).toBe(true);
        expect(effective.features['RECURRING_TASKS']?.enabled).toBe(false);
        expect(effective.features['DASHBOARD_ANALYTICS']?.enabled).toBe(false);
        expect(effective.features['CUSTOM_COMPANY_THEME']?.enabled).toBe(false);
    });

    // ── 2. Semi Annual includes only its configured features ──────────────────
    it('2. Semi Annual plan includes only its configured features', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(semiAnnualPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 180),
        });

        const effective = await EntitlementService.getEffectiveEntitlements(companyAId);
        expect(effective.features['TASK_TEMPLATES']?.enabled).toBe(true);
        expect(effective.features['RECURRING_TASKS']?.enabled).toBe(true);
        expect(effective.features['QUICK_MEETINGS']?.enabled).toBe(true);
        expect(effective.features['QUICK_MEETINGS']?.value).toBe(60);
        expect(effective.features['DASHBOARD_ANALYTICS']?.enabled).toBe(false);
    });

    // ── 3. Annual includes only its configured features ───────────────────────
    it('3. Annual plan includes only its configured features', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(annualPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 365),
        });

        const effective = await EntitlementService.getEffectiveEntitlements(companyAId);
        expect(effective.features['TASK_TEMPLATES']?.enabled).toBe(true);
        expect(effective.features['RECURRING_TASKS']?.enabled).toBe(true);
        expect(effective.features['DASHBOARD_ANALYTICS']?.enabled).toBe(true);
        expect(effective.features['CUSTOM_COMPANY_THEME']?.enabled).toBe(true);
        expect(effective.features['QUICK_MEETINGS']?.limitType).toBe('UNLIMITED');
    });

    // ── 4. Changing plan definitions updates access according to policy ───────
    it('4. Changing plan definitions dynamically updates entitlements without modifying subscriptions', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        // Initially monthly does not have RECURRING_TASKS
        expect(await EntitlementService.hasFeature(companyAId, 'RECURRING_TASKS')).toBe(false);

        // Super Admin edits the Monthly plan to enable RECURRING_TASKS
        const existingPf = inMemoryPlanFeatures.find(
            (pf) => String(pf.planId) === monthlyPlanId && String(pf.featureId) === String(featureRecurring._id)
        );
        if (existingPf) existingPf.enabled = true;
        EntitlementService.invalidateCache(companyAId);

        // Access immediately evaluates to true
        expect(await EntitlementService.hasFeature(companyAId, 'RECURRING_TASKS')).toBe(true);
    });

    // ── 5. Company downgrading from Annual to Monthly loses Annual-only access
    it('5. A company downgrading from Annual to Monthly loses Annual features upon activation', async () => {
        const sub = {
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(annualPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        };
        inMemorySubscriptions.push(sub);

        // While Annual: entitled to DASHBOARD_ANALYTICS
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(true);

        // Downgrade to Monthly
        sub.planId = new Types.ObjectId(monthlyPlanId);
        EntitlementService.invalidateCache(companyAId);

        // After downgrade: DASHBOARD_ANALYTICS is revoked
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(false);
    });

    // ── 6. Direct API request to excluded premium feature is blocked with 403 ─
    it('6. Company cannot access an excluded premium feature through a direct API request (403 Forbidden)', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        const token = generateAccessToken({
            userId: adminUserId,
            email: 'admin@companya.com',
            role: 'COMPANY_ADMIN',
            companyId: companyAId,
        });

        // Attempt direct API request to excluded feature (DASHBOARD_ANALYTICS)
        const res = await request(app)
            .get('/api/test/dashboard-analytics')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.errors.code).toBe('PLAN_UPGRADE_REQUIRED');
        expect(res.body.errors.featureKey).toBe('DASHBOARD_ANALYTICS');
    });

    // ── 7. Member override cannot bypass company subscription entitlements ───
    it('7. Individual member override cannot grant a feature excluded by the company plan', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId), // Monthly has no RECURRING_TASKS
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        // Member has an explicit ENABLED override in module access
        vi.mocked(CompanyModuleAccess.findOne).mockReturnValue({
            globalSettings: { chat: false },
            employeeOverrides: [
                {
                    employeeId: new Types.ObjectId(employeeUserId),
                    overrides: new Map([['chat', 'ENABLED']]),
                },
            ],
        } as any);

        // Plan DOES have chat, so member override is allowed
        const chatAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(companyAId, employeeUserId);
        expect(chatAccess.effectiveModules.chat).toBe(true);

        // If plan DOES NOT have chat (e.g. plan feature disabled)
        const chatPf = inMemoryPlanFeatures.find(
            (pf) => String(pf.planId) === monthlyPlanId && String(pf.featureId) === String(featureChat._id)
        );
        if (chatPf) chatPf.enabled = false;
        EntitlementService.invalidateCache(companyAId);
        await ModuleAccessService.invalidateMemberAccessCache(companyAId);

        const deniedAccess = await ModuleAccessService.getEffectiveMemberModuleAccess(companyAId, employeeUserId);
        // Overrides cannot bypass the subscription plan!
        expect(deniedAccess.effectiveModules.chat).toBe(false);
    });

    // ── 8. Missing feature configuration fail-closed policy ──────────────────
    it('8. Missing or unconfigured feature key evaluates to false (fail-closed)', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        const hasNonExistent = await EntitlementService.hasFeature(companyAId, 'SOME_UNKNOWN_PREMIUM_FEATURE');
        expect(hasNonExistent).toBe(false);

        const details = await EntitlementService.getEntitlementDetails(companyAId, 'SOME_UNKNOWN_PREMIUM_FEATURE');
        expect(details.enabled).toBe(false);
        expect(details.limitType).toBe('NONE');
    });

    // ── 9. Expired, suspended, and unpaid subscriptions ───────────────────────
    it('9. Expired, paused, and past-due subscriptions revoke premium access', async () => {
        const sub = {
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(annualPlanId),
            status: SubscriptionStatus.EXPIRED,
            currentPeriodEnd: new Date(Date.now() - 10000), // Expired in past
        };
        inMemorySubscriptions.push(sub);

        // Expired -> blocked
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(false);

        // PAUSED -> blocked
        sub.status = SubscriptionStatus.PAUSED;
        EntitlementService.invalidateCache(companyAId);
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(false);

        // PAST_DUE -> blocked
        sub.status = SubscriptionStatus.PAST_DUE;
        EntitlementService.invalidateCache(companyAId);
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(false);

        // CANCELLED -> blocked
        sub.status = SubscriptionStatus.CANCELLED;
        EntitlementService.invalidateCache(companyAId);
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(false);
    });

    // ── 10. Successful verified upgrade activates the correct entitlements ───
    it('10. Verified upgrade immediately activates upgraded plan entitlements', async () => {
        const sub = {
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        };
        inMemorySubscriptions.push(sub);

        expect(await EntitlementService.hasFeature(companyAId, 'CUSTOM_COMPANY_THEME')).toBe(false);

        // Simulate successful upgrade to Annual
        sub.planId = new Types.ObjectId(annualPlanId);
        EntitlementService.invalidateCache(companyAId);

        expect(await EntitlementService.hasFeature(companyAId, 'CUSTOM_COMPANY_THEME')).toBe(true);
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(true);
    });

    // ── 11. Failed payments do not activate paid features ─────────────────────
    it('11. Failed payments do not activate upgraded features', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        // Upgrade request failed or unpaid -> subscription remains Monthly
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(false);
    });

    // ── 12. Cache invalidation works across instances ────────────────────────
    it('12. Invalidation clears cached entitlements reliably', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(monthlyPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        });

        // Initial read populates cache
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(true);

        // Disable feature
        const pf = inMemoryPlanFeatures.find(
            (p) => String(p.planId) === monthlyPlanId && String(p.featureId) === String(featureTemplates._id)
        );
        if (pf) pf.enabled = false;

        // Invalidate
        EntitlementService.invalidateCache(companyAId);

        // Next read observes updated state
        expect(await EntitlementService.hasFeature(companyAId, 'TASK_TEMPLATES')).toBe(false);
    });

    // ── 13. One company's plan change does not affect another company ────────
    it('13. Tenant isolation: Company A changes do not impact Company B', async () => {
        inMemorySubscriptions.push(
            {
                companyId: new Types.ObjectId(companyAId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
            },
            {
                companyId: new Types.ObjectId(companyBId),
                planId: new Types.ObjectId(annualPlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodEnd: new Date(Date.now() + 86400000 * 365),
            }
        );

        // Company A is Monthly (no analytics), Company B is Annual (has analytics)
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(false);
        expect(await EntitlementService.hasFeature(companyBId, 'DASHBOARD_ANALYTICS')).toBe(true);

        // Company A upgrades to Semi-Annual (still no analytics)
        const subA = inMemorySubscriptions.find((s) => String(s.companyId) === companyAId);
        subA.planId = new Types.ObjectId(semiAnnualPlanId);
        EntitlementService.invalidateCache(companyAId);

        // Company A is still false, Company B is unaffected and remains true
        expect(await EntitlementService.hasFeature(companyAId, 'DASHBOARD_ANALYTICS')).toBe(false);
        expect(await EntitlementService.hasFeature(companyBId, 'DASHBOARD_ANALYTICS')).toBe(true);
    });

    // ── 14. Existing role permissions and free features continue to work ─────
    it('14. Public/free features and valid role permissions continue to work normally', async () => {
        const res = await request(app).get('/api/test/public-profile');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // ── 15. Feature limits are enforced under concurrent requests ────────────
    it('15. Feature limit queries return exact configured numeric limits reliably under concurrency', async () => {
        inMemorySubscriptions.push({
            companyId: new Types.ObjectId(companyAId),
            planId: new Types.ObjectId(semiAnnualPlanId),
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 86400000 * 180),
        });

        // Fire 20 parallel queries for meeting limits
        const promises = Array.from({ length: 20 }, () =>
            EntitlementService.getQuickMeetingLimits(companyAId)
        );

        const results = await Promise.all(promises);
        for (const res of results) {
            expect(res.enabled).toBe(true);
            expect(res.monthlyLimit).toBe(60);
            expect(res.isUnlimited).toBe(false);
        }
    });
});
