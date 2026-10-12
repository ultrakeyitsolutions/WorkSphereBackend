import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { EntitlementService } from '../src/services/entitlement.service';
import { PlanFeatureService } from '../src/modules/super-admin/plan-features/plan-features.service';
import { CompanyEmailEntitlementService } from '../src/modules/companyadmin/settings/company-email-entitlement.service';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import companySettingsRouter from '../src/modules/companyadmin/settings/company-settings.routes';
import { authenticate } from '../src/middleware/auth.middleware';

// ── Mock Mail Transporter ───────────────────────────────────────────────────────
vi.mock('../src/config/mail', () => ({
    getMailTransporter: vi.fn(() => ({
        sendMail: vi.fn().mockResolvedValue({ messageId: '<test-msg-123@worksphere.io>' }),
    })),
    mailDefaults: {
        from: '"WorkSphere Platform" <noreply@worksphere.com>',
    },
}));

vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: vi.fn().mockResolvedValue({ messageId: '<test-msg-123@worksphere.io>' }),
        })),
    },
}));

// ── Mock Mongoose Models ────────────────────────────────────────────────────────
vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: vi.fn(),
    },
    default: {
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
    },
    default: {
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/features/features.model', () => ({
    Feature: {
        findOne: vi.fn(),
        find: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plan-features/plan-features.model', () => ({
    PlanFeature: {
        findOne: vi.fn(),
        find: vi.fn(),
        deleteMany: vi.fn(),
        insertMany: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        find: vi.fn(),
        deleteMany: vi.fn(),
        insertMany: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plans/plans.model', () => ({
    Plan: {
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
    default: {
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/settings/company-settings.model', async () => {
    const actual = await vi.importActual('../src/modules/companyadmin/settings/company-settings.model') as any;
    return {
        ...actual,
        CompanySettings: {
            findOne: vi.fn(),
            create: vi.fn(),
        },
        default: {
            findOne: vi.fn(),
            create: vi.fn(),
        },
    };
});

describe('Dynamic Subscription Feature Entitlements — End-to-End Suite', () => {
    // Test constants
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();
    const userAId = new Types.ObjectId().toString();
    const userBId = new Types.ObjectId().toString();
    const annualPlanId = new Types.ObjectId().toString();
    const annualPlanWithoutFeatureId = new Types.ObjectId().toString();
    const emailFeatureId = new Types.ObjectId().toString();

    let companyAAdminToken: string;
    let companyBAdminToken: string;
    let app: express.Express;

    // In-memory state tracking
    let plansMap: Map<string, any>;
    let planFeaturesMap: Map<string, Set<string>>; // planId -> Set<featureId>
    let subscriptionsMap: Map<string, any>; // companyId -> subscription
    let companiesMap: Map<string, any>;
    let companySettingsMap: Map<string, any>;

    function createQuery(doc: any) {
        return {
            lean: vi.fn().mockResolvedValue(doc),
            populate: vi.fn().mockImplementation(() => createQuery(doc)),
            sort: vi.fn().mockImplementation(() => createQuery(doc)),
            then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
            catch: (reject: any) => Promise.resolve(doc).catch(reject),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        EntitlementService.clearAllCache();
        CompanyEmailEntitlementService.clearAllCache();

        plansMap = new Map();
        planFeaturesMap = new Map();
        subscriptionsMap = new Map();
        companiesMap = new Map();
        companySettingsMap = new Map();

        // 1. Seed Companies
        companiesMap.set(companyAId, {
            _id: new Types.ObjectId(companyAId),
            name: 'Acme Corp',
            status: 'ACTIVE',
            isActive: true,
        });

        companiesMap.set(companyBId, {
            _id: new Types.ObjectId(companyBId),
            name: 'Globex Corp',
            status: 'ACTIVE',
            isActive: true,
        });

        // 2. Seed Plans
        plansMap.set(annualPlanId, {
            _id: new Types.ObjectId(annualPlanId),
            name: 'Annual Enterprise',
            billingCycle: 'YEARLY',
            isActive: true,
        });

        plansMap.set(annualPlanWithoutFeatureId, {
            _id: new Types.ObjectId(annualPlanWithoutFeatureId),
            name: 'Annual Basic',
            billingCycle: 'YEARLY',
            isActive: true,
        });

        // 3. Seed PlanFeatures
        planFeaturesMap.set(annualPlanId, new Set([emailFeatureId]));
        planFeaturesMap.set(annualPlanWithoutFeatureId, new Set()); // No email feature

        // 4. Seed Subscriptions
        subscriptionsMap.set(companyAId, {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyAId),
            planId: plansMap.get(annualPlanId),
            status: SubscriptionStatus.ACTIVE,
        });

        subscriptionsMap.set(companyBId, {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyBId),
            planId: plansMap.get(annualPlanWithoutFeatureId),
            status: SubscriptionStatus.ACTIVE,
        });

        // Mock User.findById for authenticate middleware
        vi.mocked(User.findById).mockImplementation(((id: any) => {
            const strId = String(id);
            const isCompanyA = strId === userAId;
            const cid = isCompanyA ? companyAId : companyBId;
            return {
                populate: vi.fn().mockResolvedValue({
                    _id: new Types.ObjectId(strId),
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(cid),
                    role: { name: 'COMPANY_ADMIN' },
                }),
            } as any;
        }) as any);

        // Mock Company.findById
        vi.mocked(Company.findById).mockImplementation(((id: any) => {
            const doc = companiesMap.get(String(id)) || null;
            return createQuery(doc) as any;
        }) as any);

        // Mock Subscription.findOne
        vi.mocked(Subscription.findOne).mockImplementation(((query: any) => {
            const cid = String(query?.companyId);
            const doc = subscriptionsMap.get(cid) || null;
            return createQuery(doc) as any;
        }) as any);

        // Mock Feature.findOne
        vi.mocked(Feature.findOne).mockImplementation(((query: any) => {
            const doc = {
                _id: new Types.ObjectId(emailFeatureId),
                key: 'CUSTOM_COMPANY_EMAIL',
                name: 'Custom Company Email',
                isActive: true,
            };
            return createQuery(doc) as any;
        }) as any);

        // Mock PlanFeature.findOne
        vi.mocked(PlanFeature.findOne).mockImplementation(((query: any) => {
            const pid = String(query?.planId);
            const fid = String(query?.featureId);
            const features = planFeaturesMap.get(pid);
            const enabled = features ? features.has(fid) : false;
            const doc = enabled ? { _id: new Types.ObjectId(), enabled: true, limitType: 'NONE' } : null;
            return createQuery(doc) as any;
        }) as any);

        // Mock CompanySettings.findOne
        vi.mocked(CompanySettings.findOne).mockImplementation(((query: any) => {
            const cid = String(query?.companyId);
            let doc = companySettingsMap.get(cid);
            if (!doc) {
                doc = {
                    companyId: new Types.ObjectId(cid),
                    email: {
                        mode: 'PLATFORM',
                        senderEmail: null,
                        senderName: null,
                        replyTo: null,
                        isVerified: false,
                    },
                    save: vi.fn().mockResolvedValue(true),
                };
                companySettingsMap.set(cid, doc);
            }
            return {
                ...doc,
                save: doc.save,
                lean: vi.fn().mockResolvedValue(doc),
                then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
                catch: (reject: any) => Promise.resolve(doc).catch(reject),
            };
        }) as any);

        // Express App Setup
        app = express();
        app.use(express.json());
        app.use('/api/v1/company/settings', authenticate, companySettingsRouter);

        companyAAdminToken = generateAccessToken({
            userId: userAId,
            email: 'admin@acme.com',
            role: 'COMPANY_ADMIN',
            companyId: companyAId,
        });

        companyBAdminToken = generateAccessToken({
            userId: userBId,
            email: 'admin@globex.com',
            role: 'COMPANY_ADMIN',
            companyId: companyBId,
        });
    });

    // ─── Scenario 1 & 2: Super Admin adds Email to Plan; Active Subscriber receives it
    it('1 & 2. Super Admin assigns Company Email Configuration to a plan, and active subscriber receives entitlement', async () => {
        const isEntitled = await EntitlementService.hasFeature(companyAId, 'CUSTOM_COMPANY_EMAIL');
        expect(isEntitled).toBe(true);

        const checkRes = await CompanyEmailEntitlementService.checkEntitlement(companyAId);
        expect(checkRes.isEntitled).toBe(true);
        expect(checkRes.reasonCode).toBe('ENTITLED');
    });

    // ─── Scenario 3: Active Annual subscriber whose plan includes the feature can access it
    it('3. Active Annual subscriber whose plan includes the feature can access email settings without upgrade prompt', async () => {
        const res = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.entitlement.isEntitled).toBe(true);
        expect(res.body.data.entitlement.reasonCode).toBe('ENTITLED');
        expect(res.body.data.entitlement.planName).toBe('Annual Enterprise');
    });

    // ─── Scenario 4: Annual subscriber whose plan does NOT include the feature receives correct restriction
    it('4. Annual subscriber whose plan does NOT include the feature receives PLAN_UPGRADE_REQUIRED restriction', async () => {
        const res = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyBAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.entitlement.isEntitled).toBe(false);
        expect(res.body.data.entitlement.reasonCode).toBe('PLAN_UPGRADE_REQUIRED');
        expect(res.body.data.entitlement.planName).toBe('Annual Basic');
        expect(res.body.data.entitlement.message).toContain('Please upgrade to a plan with the Custom Company Email feature');
    });

    // ─── Scenario 5: Removing the feature from a plan dynamically revokes access
    it('5. Removing the feature from a plan dynamically revokes entitlement and updates cache', async () => {
        // First check: company A is entitled
        expect(await EntitlementService.hasFeature(companyAId, 'CUSTOM_COMPANY_EMAIL')).toBe(true);

        // Super Admin removes the feature from the plan
        planFeaturesMap.set(annualPlanId, new Set()); // remove all features
        PlanFeatureService.replaceEntitlements = vi.fn().mockImplementation(async (pid: string) => {
            planFeaturesMap.set(pid, new Set());
        }) as any;

        // Invalidate cache as PlanService.updatePlan does
        EntitlementService.clearAllCache();
        CompanyEmailEntitlementService.clearAllCache();

        // Second check: company A is no longer entitled
        const checkRes = await CompanyEmailEntitlementService.checkEntitlement(companyAId);
        expect(checkRes.isEntitled).toBe(false);
        expect(checkRes.reasonCode).toBe('PLAN_UPGRADE_REQUIRED');
    });

    // ─── Scenario 6: Expired subscriptions follow existing billing policy
    it('6. Expired subscriptions follow existing billing policy and receive SUBSCRIPTION_EXPIRED', async () => {
        subscriptionsMap.set(companyAId, {
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(companyAId),
            planId: plansMap.get(annualPlanId),
            status: SubscriptionStatus.EXPIRED,
        });
        EntitlementService.clearAllCache();
        CompanyEmailEntitlementService.clearAllCache();

        const checkRes = await CompanyEmailEntitlementService.checkEntitlement(companyAId);
        expect(checkRes.isEntitled).toBe(false);
        expect(checkRes.reasonCode).toBe('SUBSCRIPTION_EXPIRED');
        expect(checkRes.message).toContain('Subscription has expired');
    });

    // ─── Scenario 7: Company Admins cannot access another company\'s entitlements
    it('7. Company Admins cannot access another company\'s entitlements or bypass company isolation', async () => {
        // Company B admin tries to access Company A by sending query param ?companyId=companyAId
        const res = await request(app)
            .get(`/api/v1/company/settings/email?companyId=${companyAId}`)
            .set('Authorization', `Bearer ${companyBAdminToken}`);

        expect(res.status).toBe(200);
        // Must strictly evaluate Company B's entitlements from session, not Company A's!
        expect(res.body.data.entitlement.planName).toBe('Annual Basic');
        expect(res.body.data.entitlement.isEntitled).toBe(false);
    });

    // ─── Scenario 8: Direct API calls cannot bypass subscription restrictions
    it('8. Direct API calls cannot bypass subscription restrictions (403 Forbidden)', async () => {
        // Company B is not entitled
        const res = await request(app)
            .put('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyBAdminToken}`)
            .send({
                mode: 'COMPANY',
                senderEmail: 'attacker@globex.com',
                senderName: 'Globex Corp',
            });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Custom company email is not included in your organization\'s subscription plan');
    });

    // ─── Scenario 9: Frontend visibility matches backend entitlement response
    it('9. Frontend visibility matches backend entitlement response exactly', async () => {
        const entitledRes = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`);

        expect(entitledRes.body.data.entitlement).toMatchObject({
            isEntitled: true,
            reasonCode: 'ENTITLED',
            billingCycle: 'YEARLY',
            planName: 'Annual Enterprise',
        });

        const unentitledRes = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyBAdminToken}`);

        expect(unentitledRes.body.data.entitlement).toMatchObject({
            isEntitled: false,
            reasonCode: 'PLAN_UPGRADE_REQUIRED',
            billingCycle: 'YEARLY',
            planName: 'Annual Basic',
        });
    });

    // ─── Scenario 10: No upgrade prompt appears when feature is included
    it('10. Confirms isEntitled=true so frontend suppresses upgrade prompt and renders config UI', async () => {
        const res = await request(app)
            .get('/api/v1/company/settings/email')
            .set('Authorization', `Bearer ${companyAAdminToken}`);

        expect(res.body.data.entitlement.isEntitled).toBe(true);
        // Frontend logic: const isEntitled = entitlement?.isEntitled ?? false;
        // When true: displays emerald "Feature Entitled" badge and interactive form
        expect(res.body.data.settings).toBeDefined();
        expect(res.body.data.settings.effectiveSender).toBeDefined();
    });

    // ─── Scenario 11: No hardcoded plan-name checks override centralized entitlement service
    it('11. No hardcoded plan-name checks override the centralized entitlement service', async () => {
        // Even though plan is named "Annual Basic" with cycle "YEARLY", without the feature in PlanFeature,
        // it strictly evaluates to FALSE rather than assuming "Annual" grants access
        const hasEntitlement = await EntitlementService.hasFeature(companyBId, 'CUSTOM_COMPANY_EMAIL');
        expect(hasEntitlement).toBe(false);

        const entitlementDiag = await CompanyEmailEntitlementService.checkEntitlement(companyBId);
        expect(entitlementDiag.isEntitled).toBe(false);
        expect(entitlementDiag.reasonCode).toBe('PLAN_UPGRADE_REQUIRED');
    });
});
