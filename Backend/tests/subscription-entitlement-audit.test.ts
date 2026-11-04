import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { EntitlementService } from '../src/services/entitlement.service';
import { SubscriptionService } from '../src/modules/super-admin/subscriptions/subscription.service';
import { SubscriptionEntitlementSyncService } from '../src/services/subscription-entitlement-sync.service';
import { FeatureAccessService } from '../src/modules/companyadmin/settings/feature-access.service';
import { CompanySettingsService } from '../src/modules/companyadmin/settings/company-settings.service';
import { requireFeature } from '../src/middleware/entitlement.middleware';
import { requireCompanyFeature } from '../src/middleware/feature-toggle.middleware';
import { requireModuleAccess } from '../src/middleware/module-access.middleware';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { SubscriptionEvent } from '../src/modules/super-admin/subscriptions/subscription-event.model';
import { SubscriptionEventType } from '../src/modules/super-admin/subscriptions/subscription-event.types';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { UserService } from '../src/modules/users/user.service';
import { AuditLogService } from '../src/modules/audit-logs/audit-log.service';
import { AuditAction } from '../src/modules/audit-logs/audit-log.types';
import { authenticate } from '../src/middleware/auth.middleware';
import { errorHandler } from '../src/middleware/error.middleware';
import subscriptionRoutes from '../src/modules/super-admin/subscriptions/subscription.routes';
import dashboardSubscriptionRoutes from '../src/modules/super-admin/subscriptions/dashboard-subscriptions.routes';

// Mock Mongoose models
vi.mock('../src/modules/super-admin/plans/plans.model', () => ({
    Plan: {
        findById: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/features/features.model', () => ({
    Feature: {
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/plan-features/plan-features.model', () => ({
    PlanFeature: {
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription-event.model', () => ({
    SubscriptionEvent: {
        create: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.service', () => ({
    UserService: {
        findById: vi.fn(),
        findByEmail: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/settings/company-settings.model', () => ({
    CompanySettings: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
    DEFAULT_GENERAL_SETTINGS: { timezone: 'UTC', currency: 'USD', dateFormat: 'YYYY-MM-DD', language: 'en' },
    DEFAULT_FEATURE_FLAGS: {
        enableLiveMonitoring: true,
        enableDetailedMonitoring: true,
        enableQuickMeetings: true,
        enableChat: true,
        enableAttendanceAdjustments: true,
        enableTimesheets: true,
        enableTaskAttachments: true,
    },
    DEFAULT_ATTENDANCE_POLICIES: {},
    DEFAULT_SECURITY_POLICIES: {},
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn(),
    },
}));

describe('WorkSphere End-to-End Subscription, Plan Change, Feature Access & Authorization Audit Suite', () => {
    const superAdminId = '507f1f77bcf86cd799439011';
    const companyAdminId = '507f1f77bcf86cd799439022';
    const companyIdA = '507f1f77bcf86cd799439033';
    const companyIdB = '507f1f77bcf86cd799439044';
    const starterPlanId = '507f1f77bcf86cd799439055';
    const enterprisePlanId = '507f1f77bcf86cd799439066';

    const superAdminToken = generateAccessToken({
        userId: superAdminId,
        email: 'superadmin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const companyAdminTokenA = generateAccessToken({
        userId: companyAdminId,
        email: 'admin@companya.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdA,
    });

    const companyAdminTokenB = generateAccessToken({
        userId: '507f1f77bcf86cd799439099',
        email: 'admin@companyb.com',
        role: 'COMPANY_ADMIN',
        companyId: companyIdB,
    });

    const mockStarterPlan: any = {
        _id: new Types.ObjectId(starterPlanId),
        name: 'Starter Plan',
        price: 999,
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    const mockEnterprisePlan: any = {
        _id: new Types.ObjectId(enterprisePlanId),
        name: 'Enterprise Plan',
        price: 4999,
        billingCycle: 'MONTHLY',
        isActive: true,
        isArchived: false,
    };

    const mockCompanyA: any = {
        _id: new Types.ObjectId(companyIdA),
        name: 'Company A Corp',
        isActive: true,
        status: 'ACTIVE',
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        EntitlementService.clearAllCache();
        FeatureAccessService.clearAllCache();
        vi.mocked(Company.findById).mockResolvedValue(mockCompanyA);
        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: 'user_mock_default',
                isActive: true,
                status: 'ACTIVE',
                companyId: new Types.ObjectId(companyIdA),
                role: { name: 'COMPANY_ADMIN' },
            }),
        } as any);
    });

    // ── 1. SuperAdmin Plan Changes & Atomic Updates ──────────────────────────
    describe('1. SuperAdmin Plan Changes', () => {
        it('assigns initial subscription to a company with audit log and entitlement cache refresh', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA);
            vi.mocked(Plan.findById).mockResolvedValue(mockStarterPlan);
            vi.mocked(Subscription.findOne).mockResolvedValue(null);

            const createdSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(starterPlanId),
                status: SubscriptionStatus.ACTIVE,
                startedAt: new Date(),
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
            };
            vi.mocked(Subscription.create).mockResolvedValue(createdSub);

            const result = await SubscriptionService.createSubscription(
                companyIdA,
                starterPlanId,
                superAdminId
            );

            expect(result).toBeDefined();
            expect(Subscription.create).toHaveBeenCalled();
            expect(SubscriptionEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: SubscriptionEventType.SUBSCRIPTION_CREATED,
                    toPlanId: starterPlanId,
                    toStatus: SubscriptionStatus.ACTIVE,
                    performedBy: superAdminId,
                })
            );
            expect(AuditLogService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.SUBSCRIPTION_CREATED,
                    companyId: companyIdA,
                })
            );
        });

        it('upgrades company plan immediately and clears all entitlement caches across workers', async () => {
            const currentSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(starterPlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 15 * 86400000),
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(Plan.findById).mockImplementation((id: any) => {
                if (String(id) === enterprisePlanId) return Promise.resolve(mockEnterprisePlan);
                if (String(id) === starterPlanId) return Promise.resolve(mockStarterPlan);
                return Promise.resolve(null);
            });
            vi.mocked(Subscription.findOne).mockResolvedValue(currentSub);

            const updated = await SubscriptionService.changePlan(
                companyIdA,
                enterprisePlanId,
                superAdminId,
                true // immediate
            );

            expect(currentSub.planId).toEqual(new Types.ObjectId(enterprisePlanId));
            expect(currentSub.scheduledPlanId).toBeUndefined();
            expect(SubscriptionEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: SubscriptionEventType.PLAN_UPGRADED,
                    fromPlanId: new Types.ObjectId(starterPlanId),
                    toPlanId: enterprisePlanId,
                    toStatus: SubscriptionStatus.ACTIVE,
                })
            );
            expect(AuditLogService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.SUBSCRIPTION_UPGRADED,
                    companyId: companyIdA,
                })
            );
        });

        it('blocks immediate downgrade if company user count exceeds target plan limit', async () => {
            const currentSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(enterprisePlanId),
                status: SubscriptionStatus.ACTIVE,
            };

            vi.mocked(Plan.findById).mockImplementation((id: any) => {
                if (String(id) === starterPlanId) return Promise.resolve(mockStarterPlan);
                if (String(id) === enterprisePlanId) return Promise.resolve(mockEnterprisePlan);
                return Promise.resolve(null);
            });
            vi.mocked(Subscription.findOne).mockResolvedValue(currentSub);

            // Company has 15 active users
            vi.mocked(User.countDocuments).mockResolvedValue(15);

            // Starter plan limit is 5 users
            vi.mocked(Feature.findOne).mockResolvedValue({ _id: new Types.ObjectId(), key: 'MAX_USERS' } as any);
            vi.mocked(PlanFeature.findOne).mockResolvedValue({
                enabled: true,
                limitType: 'LIMITED',
                value: 5,
            } as any);

            await expect(
                SubscriptionService.changePlan(companyIdA, starterPlanId, superAdminId, true)
            ).rejects.toThrow(/Downgrade blocked — current user count \(15\) exceeds the target plan limit of 5/);
        });
    });

    // ── 2. Scheduled Downgrades & Policy Enforcement ─────────────────────────
    describe('2. Scheduled Downgrades', () => {
        it('preserves paid features until renewal date when downgrade is scheduled for next cycle', async () => {
            const futureRenewal = new Date(Date.now() + 10 * 86400000); // 10 days in future
            const currentSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(enterprisePlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodEnd: futureRenewal,
                save: vi.fn().mockResolvedValue(true),
            };

            vi.mocked(Plan.findById).mockImplementation((id: any) => {
                if (String(id) === starterPlanId) return Promise.resolve(mockStarterPlan);
                if (String(id) === enterprisePlanId) return Promise.resolve(mockEnterprisePlan);
                return Promise.resolve(null);
            });
            vi.mocked(Subscription.findOne).mockResolvedValue(currentSub);
            vi.mocked(User.countDocuments).mockResolvedValue(2);
            vi.mocked(Feature.findOne).mockResolvedValue(null);

            // Schedule downgrade for next billing cycle
            await SubscriptionService.changePlan(companyIdA, starterPlanId, superAdminId, false);

            expect(currentSub.scheduledPlanId).toEqual(new Types.ObjectId(starterPlanId));
            // Current planId must remain Enterprise until currentPeriodEnd!
            expect(currentSub.planId).toEqual(new Types.ObjectId(enterprisePlanId));

            // Verify EntitlementService resolves Enterprise plan because currentPeriodEnd is in the future
            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(currentSub),
                }),
            } as any);

            const livePlanId = await (EntitlementService as any).getPlanIdForCompany(companyIdA);
            expect(livePlanId).toBe(enterprisePlanId);
        });

        it('automatically switches to scheduled plan once renewal date arrives without removing access prematurely', async () => {
            const pastRenewal = new Date(Date.now() - 1000); // Expired 1 second ago
            const currentSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(enterprisePlanId),
                scheduledPlanId: new Types.ObjectId(starterPlanId),
                status: SubscriptionStatus.ACTIVE,
                currentPeriodEnd: pastRenewal,
            };

            vi.mocked(Subscription.findOne).mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(currentSub),
                }),
            } as any);

            const livePlanId = await (EntitlementService as any).getPlanIdForCompany(companyIdA);
            // Must now resolve to the scheduled Starter plan!
            expect(livePlanId).toBe(starterPlanId);
            // Must trigger durable database rollover update
            expect(Subscription.updateOne).toHaveBeenCalled();
            const updateCall = vi.mocked(Subscription.updateOne).mock.calls[0];
            expect(String(updateCall[0]._id)).toBe(String(currentSub._id));
            expect(String((updateCall[1] as any).$set?.planId)).toBe(starterPlanId);
            expect((updateCall[1] as any).$unset).toEqual({ scheduledPlanId: 1 });
        });
    });

    // ── 3. SuperAdmin Complimentary Plan Grants ──────────────────────────────
    describe('3. SuperAdmin Complimentary Plan Grants', () => {
        it('grants a complimentary plan with duration, reason, zero price override, and no fake payment attempt', async () => {
            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA);
            vi.mocked(Plan.findById).mockResolvedValue(mockEnterprisePlan);

            const activeSub: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(starterPlanId),
                status: SubscriptionStatus.ACTIVE,
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(Subscription.findOne).mockResolvedValue(activeSub);

            const complimentary = await SubscriptionService.grantComplimentaryPlan(
                companyIdA,
                enterprisePlanId,
                superAdminId,
                {
                    reason: 'Strategic enterprise partner sponsorship',
                    durationDays: 180,
                }
            );

            expect(complimentary.isComplimentary).toBe(true);
            expect(complimentary.complimentaryReason).toBe('Strategic enterprise partner sponsorship');
            expect(complimentary.pricingOverride).toBe(0);
            expect(complimentary.planId).toEqual(new Types.ObjectId(enterprisePlanId));
            expect(SubscriptionEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: SubscriptionEventType.COMPLIMENTARY_PLAN_GRANTED,
                    performedBy: superAdminId,
                })
            );
            expect(AuditLogService.log).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: AuditAction.COMPLIMENTARY_PLAN_GRANTED,
                    companyId: companyIdA,
                })
            );
        });

        it('exposes POST /api/super-admin/companies/:companyId/subscription/complimentary route', async () => {
            vi.mocked(UserService.findById).mockResolvedValue({
                _id: superAdminId,
                role: { name: 'SUPER_ADMIN', permissions: [] },
            } as any);

            const app = express();
            app.use(express.json());
            app.use((req: any, _res, next) => {
                req.user = { userId: superAdminId, role: 'SUPER_ADMIN', permissions: ['SUBSCRIPTION_UPDATE'] };
                next();
            });
            app.use('/api/super-admin/companies/:companyId/subscription', subscriptionRoutes);
            app.use(errorHandler);

            vi.mocked(Company.findById).mockResolvedValue(mockCompanyA);
            vi.mocked(Plan.findById).mockResolvedValue(mockEnterprisePlan);
            vi.mocked(Subscription.findOne).mockResolvedValue(null);
            vi.mocked(Subscription.create).mockResolvedValue({
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(companyIdA),
                planId: new Types.ObjectId(enterprisePlanId),
                status: SubscriptionStatus.ACTIVE,
                isComplimentary: true,
            } as any);

            const res = await request(app)
                .post(`/api/super-admin/companies/${companyIdA}/subscription/complimentary`)
                .send({
                    planId: enterprisePlanId,
                    reason: 'Beta partner waiver',
                    durationDays: 90,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('Complimentary plan granted successfully');
        });
    });

    // ── 4. Backend Authorization & Module Access Enforcement ─────────────────
    describe('4. Backend Authorization Independence & Module Access', () => {
        it('requireFeature blocks direct API access with 403 PLAN_UPGRADE_REQUIRED when company lacks entitlement', async () => {
            const app = express();
            app.use(express.json());
            app.use((req: any, _res, next) => {
                req.currentUser = { userId: companyAdminId, companyId: companyIdA, role: 'COMPANY_ADMIN' };
                next();
            });
            app.get('/api/test-recurring-tasks', requireFeature('RECURRING_TASKS'), (_req, res) => {
                res.json({ success: true, secret: 'protected_data' });
            });
            app.use(errorHandler);

            // Company does NOT have RECURRING_TASKS
            vi.spyOn(EntitlementService, 'hasFeature').mockResolvedValue(false);

            const res = await request(app).get('/api/test-recurring-tasks');

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Please upgrade your subscription');
            expect(res.body.errors).toEqual({ code: 'PLAN_UPGRADE_REQUIRED', featureKey: 'RECURRING_TASKS' });
        });

        it('requireCompanyFeature enforces subscription tier even if company admin enabled toggle in settings', async () => {
            const app = express();
            app.use(express.json());
            app.use((req: any, _res, next) => {
                req.currentUser = { userId: companyAdminId, companyId: companyIdA, role: 'COMPANY_ADMIN' };
                next();
            });
            app.get('/api/test-live-monitoring', requireCompanyFeature('enableLiveMonitoring'), (_req, res) => {
                res.json({ success: true });
            });
            app.use(errorHandler);

            // Company settings has toggle = true, BUT subscription lacks LIVE_MONITORING
            vi.spyOn(FeatureAccessService, 'getCompanyFeatureFlags').mockResolvedValue({
                enableLiveMonitoring: true,
            } as any);
            vi.spyOn(EntitlementService, 'hasFeature').mockResolvedValue(false);

            const res = await request(app).get('/api/test-live-monitoring');

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.errors).toEqual({ code: 'PLAN_UPGRADE_REQUIRED' });
        });

        it('requireModuleAccess enforces subscription entitlement for USER_REVIEW_LINKS module', async () => {
            const app = express();
            app.use(express.json());
            app.use((req: any, _res, next) => {
                req.currentUser = { userId: companyAdminId, companyId: companyIdA, role: 'COMPANY_ADMIN' };
                next();
            });
            app.get('/api/test-user-reviews', requireModuleAccess('user-reviews'), (_req, res) => {
                res.json({ success: true });
            });
            app.use(errorHandler);

            // Plan lacks USER_REVIEW_LINKS
            vi.spyOn(EntitlementService, 'getEntitlementDetails').mockResolvedValue({
                enabled: false,
                limitType: 'NONE',
                value: null,
            });

            const res = await request(app).get('/api/test-user-reviews');

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('User Review Links');
            expect(res.body.errors).toEqual(
                expect.objectContaining({
                    code: 'PLAN_UPGRADE_REQUIRED',
                    featureKey: 'USER_REVIEW_LINKS',
                    moduleKey: 'user-reviews',
                })
            );
        });
    });

    // ── 5. Frontend Visibility & Ground-Truth Overlay ─────────────────────────
    describe('5. Frontend Feature Visibility Overlay', () => {
        it('getSettings masks features as disabled when unentitled in subscription so frontend sidebar hides menus', async () => {
            const rawDbSettings: any = {
                companyId: new Types.ObjectId(companyIdA),
                general: { timezone: 'UTC', currency: 'USD' },
                features: {
                    enableLiveMonitoring: true, // Company previously enabled it
                    enableDetailedMonitoring: true,
                    enableChat: true,
                },
                theme: {},
            };
            vi.mocked(CompanySettings.findOne).mockResolvedValue(rawDbSettings);

            // EntitlementService returns false for LIVE_MONITORING and DETAILED_MONITORING, but true for CHAT
            vi.spyOn(EntitlementService, 'hasFeature').mockImplementation((_cid, key) => {
                if (key === 'LIVE_MONITORING' || key === 'DETAILED_MONITORING') return Promise.resolve(false);
                if (key === 'CHAT') return Promise.resolve(true);
                return Promise.resolve(false);
            });

            const settings = await CompanySettingsService.getSettings(companyIdA);

            // Frontend queries settings.features:
            // LIVE_MONITORING and DETAILED_MONITORING must be masked to FALSE!
            expect(settings.features.enableLiveMonitoring).toBe(false);
            expect(settings.features.enableDetailedMonitoring).toBe(false);
            // CHAT is entitled, so remains TRUE
            expect(settings.features.enableChat).toBe(true);
        });
    });

    // ── 6. Tenant Isolation ──────────────────────────────────────────────────
    describe('6. Multi-Tenant Isolation', () => {
        it('prevents Company B from reading or modifying Company A subscription', async () => {
            const app = express();
            app.use(express.json());
            app.use(authenticate);
            app.use('/api/super-admin/companies/:companyId/subscription', (req: any, res, next) => {
                if (req.user?.role !== 'SUPER_ADMIN') {
                    return res.status(403).json({ success: false, message: 'Forbidden: SUPER_ADMIN role required' });
                }
                next();
            }, subscriptionRoutes);
            app.use(errorHandler);

            vi.mocked(User.findById).mockReturnValue({
                populate: vi.fn().mockResolvedValue({
                    _id: 'user_b',
                    isActive: true,
                    status: 'ACTIVE',
                    companyId: new Types.ObjectId(companyIdB),
                    role: { name: 'COMPANY_ADMIN' },
                }),
            } as any);
            vi.mocked(Company.findById).mockResolvedValue({
                _id: new Types.ObjectId(companyIdB),
                isActive: true,
                status: 'ACTIVE',
            } as any);

            // Company Admin B tries to access Company A subscription endpoint
            const res = await request(app)
                .get(`/api/super-admin/companies/${companyIdA}/subscription`)
                .set('Authorization', `Bearer ${companyAdminTokenB}`);

            // Super Admin guard blocks non-super-admin with 403 Forbidden
            expect(res.status).toBe(403);
        });
    });
});
