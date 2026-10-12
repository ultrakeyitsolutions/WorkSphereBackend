import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { SubscriptionQuotaService } from '../src/services/subscription-quota.service';
import { EntitlementService } from '../src/services/entitlement.service';
import { FileService } from '../src/modules/files/file.service';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { CompanyMember } from '../src/modules/companyadmin/invitations/company-member.model';
import { Invitation } from '../src/modules/companyadmin/invitations/invitation.model';
import { User } from '../src/modules/users/user.model';
import { FileModel } from '../src/modules/files/file.model';
import { QuotaReservation } from '../src/modules/super-admin/entitlements/quota-reservation.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../src/modules/super-admin/subscriptions/subscription.types';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { StorageConfigurationService } from '../src/modules/super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../src/infrastructure/storage/storage-provider.factory';
import { AppError } from '../src/utils/AppError';

// ── Mock Models ─────────────────────────────────────────────────────────────
vi.mock('../src/modules/companyadmin/projects/project.model');
vi.mock('../src/modules/tasks/task.model');
vi.mock('../src/modules/companyadmin/invitations/company-member.model');
vi.mock('../src/modules/companyadmin/invitations/invitation.model');
vi.mock('../src/modules/users/user.model');
vi.mock('../src/modules/files/file.model');
vi.mock('../src/modules/super-admin/entitlements/quota-reservation.model');
vi.mock('../src/modules/super-admin/subscriptions/subscription.model');
vi.mock('../src/modules/super-admin/plans/plans.model');
vi.mock('../src/modules/super-admin/features/features.model');
vi.mock('../src/modules/super-admin/plan-features/plan-features.model');
vi.mock('../src/modules/super-admin/storage/storage-config.service');
vi.mock('../src/infrastructure/storage/storage-provider.factory');

// Mock Mail Transporter for invitation emails
vi.mock('../src/config/mail', () => ({
    getMailTransporter: vi.fn(() => ({
        sendMail: vi.fn().mockResolvedValue({ messageId: '<test-quota-msg@worksphere.io>' }),
    })),
    mailDefaults: {
        from: '"WorkSphere Platform" <noreply@worksphere.com>',
    },
}));
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: vi.fn().mockResolvedValue({ messageId: '<test-quota-msg@worksphere.io>' }),
        })),
    },
}));

describe('WorkSphere: Subscription Resource Limits Enforcement Suite', () => {
    const companyAId = new Types.ObjectId().toString();
    const companyBId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();
    const projectId = new Types.ObjectId().toString();

    // Features catalog
    const featureProjects = { _id: new Types.ObjectId(), key: 'PROJECTS', name: 'Projects', isActive: true, type: 'LIMIT' };
    const featureTasks = { _id: new Types.ObjectId(), key: 'TASKS', name: 'Tasks', isActive: true, type: 'LIMIT' };
    const featureUsers = { _id: new Types.ObjectId(), key: 'USERS', name: 'Users / Team Members', isActive: true, type: 'LIMIT' };
    const featureStorage = { _id: new Types.ObjectId(), key: 'STORAGE', name: 'Storage Capacity', isActive: true, type: 'LIMIT' };

    // Plans
    const monthlyPlanId = new Types.ObjectId().toString();
    const annualPlanId = new Types.ObjectId().toString();

    const monthlyPlan = { _id: new Types.ObjectId(monthlyPlanId), name: 'Monthly Starter', billingCycle: 'MONTHLY', isActive: true };
    const annualPlan = { _id: new Types.ObjectId(annualPlanId), name: 'Annual Enterprise', billingCycle: 'YEARLY', isActive: true };

    // In-memory data store for tests
    let inMemorySubscriptions: any[] = [];
    let inMemoryPlanFeatures: any[] = [];
    let inMemoryReservations: any[] = [];
    let inMemoryProjects: any[] = [];
    let inMemoryTasks: any[] = [];
    let inMemoryMembers: any[] = [];
    let inMemoryInvitations: any[] = [];
    let inMemoryUsers: any[] = [];
    let inMemoryFiles: any[] = [];

    // Mock storage provider
    const mockStorageProvider = {
        uploadFile: vi.fn().mockResolvedValue({ storageKey: 'test/storage/key.png', storageUrl: 'https://cdn.example.com/key.png' }),
        deleteFile: vi.fn().mockResolvedValue(true),
        getFileUrl: vi.fn().mockReturnValue('https://cdn.example.com/key.png'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        EntitlementService.clearAllCache();

        inMemorySubscriptions = [
            {
                companyId: new Types.ObjectId(companyAId),
                planId: new Types.ObjectId(monthlyPlanId),
                status: SubscriptionStatus.ACTIVE,
                startDate: new Date(Date.now() - 86400000),
                endDate: new Date(Date.now() + 86400000 * 30),
            },
            {
                companyId: new Types.ObjectId(companyBId),
                planId: new Types.ObjectId(annualPlanId),
                status: SubscriptionStatus.ACTIVE,
                startDate: new Date(Date.now() - 86400000),
                endDate: new Date(Date.now() + 86400000 * 365),
            },
        ];

        // Default Monthly limits: 10 Projects, 20 Tasks, 5 Users, 10 GB Storage
        inMemoryPlanFeatures = [
            // Monthly
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureProjects._id, enabled: true, limitType: 'LIMITED', value: 10, unit: 'COUNT' },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureTasks._id, enabled: true, limitType: 'LIMITED', value: 20, unit: 'PER_PROJECT' },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureUsers._id, enabled: true, limitType: 'LIMITED', value: 5, unit: 'SEATS' },
            { planId: new Types.ObjectId(monthlyPlanId), featureId: featureStorage._id, enabled: true, limitType: 'LIMITED', value: 10, unit: 'GB' },

            // Annual: 50 Projects, 100 Tasks, 25 Users, 50 GB Storage
            { planId: new Types.ObjectId(annualPlanId), featureId: featureProjects._id, enabled: true, limitType: 'LIMITED', value: 50, unit: 'COUNT' },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureTasks._id, enabled: true, limitType: 'LIMITED', value: 100, unit: 'PER_PROJECT' },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureUsers._id, enabled: true, limitType: 'LIMITED', value: 25, unit: 'SEATS' },
            { planId: new Types.ObjectId(annualPlanId), featureId: featureStorage._id, enabled: true, limitType: 'LIMITED', value: 50, unit: 'GB' },
        ];

        inMemoryReservations = [];
        inMemoryProjects = [];
        inMemoryTasks = [];
        inMemoryMembers = [];
        inMemoryInvitations = [];
        inMemoryUsers = [];
        inMemoryFiles = [];

        // ── Subscription mock ──
        vi.mocked(Subscription.findOne).mockImplementation(((query: any) => {
            const sub = inMemorySubscriptions.find(s => String(s.companyId) === String(query.companyId));
            let subData: any = null;
            if (sub) {
                const pIdStr = String(sub.planId?._id || sub.planId);
                const planObj = pIdStr === annualPlanId ? annualPlan : monthlyPlan;
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

        // ── Feature & PlanFeature mocks ──
        vi.mocked(Feature.find).mockImplementation((() => ({
            lean: vi.fn().mockResolvedValue([featureProjects, featureTasks, featureUsers, featureStorage]),
        })) as any);

        vi.mocked(Feature.findOne).mockImplementation(((query: any) => {
            let found: any = null;
            const queryKeys: string[] = [];
            if (query.key) {
                if (Array.isArray(query.key.$in)) queryKeys.push(...query.key.$in);
                else queryKeys.push(query.key);
            }
            if (query.$or) {
                for (const cond of query.$or) {
                    if (cond.key?.$in) queryKeys.push(...cond.key.$in);
                    else if (cond.key) queryKeys.push(cond.key);
                }
            }
            if (queryKeys.some(k => ['PROJECTS', 'MAX_PROJECTS'].includes(k))) found = featureProjects;
            else if (queryKeys.some(k => ['TASKS', 'MAX_TASKS'].includes(k))) found = featureTasks;
            else if (queryKeys.some(k => ['USERS', 'MAX_USERS', 'EMPLOYEES', 'SEATS'].includes(k))) found = featureUsers;
            else if (queryKeys.some(k => ['STORAGE', 'MAX_STORAGE', 'STORAGE_LIMIT', 'STORAGE_GB'].includes(k))) found = featureStorage;

            return {
                lean: vi.fn().mockResolvedValue(found ? { ...found } : null),
                then: (resolve: any) => resolve(found ? { ...found } : null),
            } as any;
        }) as any);

        vi.mocked(PlanFeature.findOne).mockImplementation(((query: any) => {
            const pf = inMemoryPlanFeatures.find(
                p => String(p.planId) === String(query.planId) && String(p.featureId) === String(query.featureId)
            );
            return {
                lean: vi.fn().mockResolvedValue(pf ? { ...pf } : null),
                then: (resolve: any) => resolve(pf ? { ...pf } : null),
            } as any;
        }) as any);

        vi.mocked(PlanFeature.find).mockImplementation(((query: any) => {
            const pfs = inMemoryPlanFeatures.filter(p => String(p.planId) === String(query.planId));
            return {
                lean: vi.fn().mockResolvedValue(pfs),
                then: (resolve: any) => resolve(pfs),
            } as any;
        }) as any);

        // ── Project Model mock ──
        vi.mocked(Project.countDocuments).mockImplementation(((query: any) => {
            const count = inMemoryProjects.filter(p => {
                if (String(p.companyId) !== String(query.companyId)) return false;
                if (query.deletedAt === null && p.deletedAt != null) return false;
                return true;
            }).length;
            return Promise.resolve(count) as any;
        }) as any);

        // ── Task Model mock ──
        vi.mocked(Task.countDocuments).mockImplementation(((query: any) => {
            const count = inMemoryTasks.filter(t => {
                if (query.projectId && String(t.projectId) !== String(query.projectId)) return false;
                if (query.companyId && String(t.companyId) !== String(query.companyId)) return false;
                if (query.isArchived === false && t.isArchived !== false) return false;
                return true;
            }).length;
            return Promise.resolve(count) as any;
        }) as any);

        // ── CompanyMember Model mock ──
        vi.mocked(CompanyMember.find).mockImplementation(((query: any) => {
            const list = inMemoryMembers.filter(m => {
                if (String(m.companyId) !== String(query.companyId)) return false;
                if (query.status && m.status !== query.status) return false;
                return true;
            });
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                distinct: vi.fn().mockResolvedValue(list.map(m => m.userId)),
                lean: vi.fn().mockResolvedValue(list),
                then: (resolve: any) => resolve(list),
            };
            return chain;
        }) as any);

        // ── User Model mock ──
        vi.mocked(User.find).mockImplementation(((query: any) => {
            const list = inMemoryUsers.filter(u => {
                if (String(u.companyId) !== String(query.companyId)) return false;
                return true;
            });
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                distinct: vi.fn().mockResolvedValue(list.map(u => u._id)),
                lean: vi.fn().mockResolvedValue(list),
                then: (resolve: any) => resolve(list),
            };
            return chain;
        }) as any);

        // ── Invitation Model mock ──
        vi.mocked(Invitation.find).mockImplementation(((query: any) => {
            const list = inMemoryInvitations.filter(i => {
                if (String(i.companyId) !== String(query.companyId)) return false;
                if (query.status && i.status !== query.status) return false;
                return true;
            });
            return {
                distinct: vi.fn().mockResolvedValue(list.map(i => i.email)),
            } as any;
        }) as any);

        vi.mocked(Invitation.countDocuments).mockImplementation(((query: any) => {
            const count = inMemoryInvitations.filter(i => {
                if (String(i.companyId) !== String(query.companyId)) return false;
                if (query.status && i.status !== query.status) return false;
                return true;
            }).length;
            return Promise.resolve(count) as any;
        }) as any);

        // ── File Model mock ──
        vi.mocked(FileModel.aggregate).mockImplementation(((pipeline: any[]) => {
            const matchStage = pipeline.find(s => s.$match)?.$match || {};
            const matchedFiles = inMemoryFiles.filter(f => {
                if (matchStage.companyId && String(f.companyId) !== String(matchStage.companyId)) return false;
                if (matchStage.deletedAt === null && f.deletedAt != null) return false;
                return true;
            });
            const totalBytes = matchedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
            return Promise.resolve([{ _id: null, totalBytes }]) as any;
        }) as any);

        // ── QuotaReservation mock ──
        vi.mocked(QuotaReservation.aggregate).mockImplementation(((pipeline: any[]) => {
            const matchStage = pipeline.find(s => s.$match)?.$match || {};
            const matchedRes = inMemoryReservations.filter(r => {
                if (matchStage.companyId && String(r.companyId) !== String(matchStage.companyId)) return false;
                if (matchStage.resource && r.resource !== matchStage.resource) return false;
                if (matchStage.status && r.status !== matchStage.status) return false;
                if (matchStage.expiresAt && r.expiresAt <= new Date()) return false;
                if (matchStage._id?.$lte) {
                    if (String(r._id) > String(matchStage._id.$lte)) return false;
                }
                return true;
            });
            const totalReserved = matchedRes.reduce((sum, r) => sum + (r.amount || 0), 0);
            return Promise.resolve([{ _id: null, totalReserved }]) as any;
        }) as any);

        vi.mocked(QuotaReservation.create).mockImplementation(((docs: any) => {
            const doc = Array.isArray(docs) ? docs[0] : docs;
            const created = {
                _id: new Types.ObjectId(),
                ...doc,
                status: 'PENDING',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 30000),
            };
            inMemoryReservations.push(created);
            return Promise.resolve(created) as any;
        }) as any);

        vi.mocked(QuotaReservation.deleteOne).mockImplementation(((filter: any) => {
            const idx = inMemoryReservations.findIndex(r => String(r._id) === String(filter._id));
            if (idx !== -1) {
                inMemoryReservations.splice(idx, 1);
            }
            return Promise.resolve({ deletedCount: idx !== -1 ? 1 : 0 }) as any;
        }) as any);

        // ── Storage Configuration & Factory mocks ──
        vi.mocked(StorageConfigurationService.getActiveConfiguration).mockResolvedValue({
            enabled: true,
            provider: 'BUNNY' as any,
            configuration: { basePath: 'worksphere' },
            limits: { imageMaxSizeMB: 50, documentMaxSizeMB: 100, audioMaxSizeMB: 50, videoMaxSizeMB: 200 },
            allowedTypes: {
                image: ['png', 'jpg', 'jpeg'],
                document: ['pdf', 'docx'],
                audio: ['mp3'],
                video: ['mp4'],
            },
        } as any);

        vi.mocked(StorageProviderFactory.createProvider).mockReturnValue(mockStorageProvider as any);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: Company on 10 project limit with 9 existing can create 1 more
    // ─────────────────────────────────────────────────────────────────────────
    it('1. Company with 9/10 projects can create 1 more project successfully', async () => {
        // Set up 9 active projects
        for (let i = 0; i < 9; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        const quotaStatus = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(quotaStatus.allowed).toBe(true);
        expect(quotaStatus.currentUsage).toBe(9);
        expect(quotaStatus.limit).toBe(10);
        expect(quotaStatus.remaining).toBe(1);

        // Reserving 1 unit succeeds
        const reservation = await SubscriptionQuotaService.reserveQuota(companyAId, 'projects', 1);
        expect(reservation.reservationId).toBeTruthy();
        await reservation.commit();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: Company with 10/10 projects is denied with PLAN_LIMIT_REACHED
    // ─────────────────────────────────────────────────────────────────────────
    it('2. Company with 10/10 projects is denied creation with PLAN_LIMIT_REACHED (403, current=10, limit=10)', async () => {
        for (let i = 0; i < 10; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        const quotaStatus = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(quotaStatus.allowed).toBe(false);
        expect(quotaStatus.reason).toBe('PLAN_LIMIT_REACHED');
        expect(quotaStatus.currentUsage).toBe(10);
        expect(quotaStatus.limit).toBe(10);
        expect(quotaStatus.remaining).toBe(0);

        await expect(SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1)).rejects.toThrow(AppError);

        try {
            await SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1);
        } catch (err: any) {
            expect(err.statusCode).toBe(403);
            expect(err.errors).toMatchObject({
                code: 'PLAN_LIMIT_REACHED',
                resource: 'projects',
                currentUsage: 10,
                limit: 10,
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: Company exceeding limit (11/10) cannot create more projects
    // ─────────────────────────────────────────────────────────────────────────
    it('3. Company exceeding limit (11/10) cannot create more projects', async () => {
        for (let i = 0; i < 11; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        const quotaStatus = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(quotaStatus.allowed).toBe(false);
        expect(quotaStatus.reason).toBe('PLAN_LIMIT_REACHED');
        expect(quotaStatus.currentUsage).toBe(11);
        expect(quotaStatus.limit).toBe(10);
        expect(quotaStatus.remaining).toBe(0);

        await expect(SubscriptionQuotaService.reserveQuota(companyAId, 'projects', 1)).rejects.toThrow(AppError);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 4: Company on Annual plan gets 50 projects, not hardcoded Monthly limit
    // ─────────────────────────────────────────────────────────────────────────
    it('4. Company on Annual plan gets configured Annual quota (50 projects), not hardcoded Monthly limit', async () => {
        // Company B is on Annual plan (configured limit: 50)
        for (let i = 0; i < 20; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyBId), deletedAt: null });
        }

        const quotaStatus = await SubscriptionQuotaService.checkQuota(companyBId, 'projects', 1);
        expect(quotaStatus.allowed).toBe(true);
        expect(quotaStatus.currentUsage).toBe(20);
        expect(quotaStatus.limit).toBe(50);
        expect(quotaStatus.remaining).toBe(30);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 5: Plan limit update dynamically takes effect without restart
    // ─────────────────────────────────────────────────────────────────────────
    it('5. When Super Admin updates plan limit (10 -> 15), company can immediately create project #11', async () => {
        for (let i = 0; i < 10; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        // Before update: denied at 10/10
        const before = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(before.allowed).toBe(false);

        // Super Admin updates limit from 10 to 15 in database
        const targetPf = inMemoryPlanFeatures.find(
            p => String(p.planId) === monthlyPlanId && String(p.featureId) === String(featureProjects._id)
        );
        targetPf.value = 15;

        // Clear cached entitlement
        EntitlementService.clearAllCache();

        // After update: allowed (10/15)
        const after = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(after.allowed).toBe(true);
        expect(after.currentUsage).toBe(10);
        expect(after.limit).toBe(15);
        expect(after.remaining).toBe(5);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 6: Disabled feature rejects with PLAN_UPGRADE_REQUIRED
    // ─────────────────────────────────────────────────────────────────────────
    it('6. When a feature is disabled in plan, creation is rejected with PLAN_UPGRADE_REQUIRED', async () => {
        const targetPf = inMemoryPlanFeatures.find(
            p => String(p.planId) === monthlyPlanId && String(p.featureId) === String(featureProjects._id)
        );
        targetPf.enabled = false;

        EntitlementService.clearAllCache();

        const status = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(status.allowed).toBe(false);
        expect(status.reason).toBe('PLAN_UPGRADE_REQUIRED');
        expect(status.upgradeGuidance).toContain('not included in your current subscription');

        try {
            await SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1);
        } catch (err: any) {
            expect(err.statusCode).toBe(403);
            expect(err.errors.code).toBe('PLAN_UPGRADE_REQUIRED');
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 7: Missing or null feature fails closed, never unlimited by default
    // ─────────────────────────────────────────────────────────────────────────
    it('7. When feature configuration is missing or null, backend fails closed with PLAN_UPGRADE_REQUIRED', async () => {
        // Remove project feature configuration for Monthly plan entirely
        inMemoryPlanFeatures = inMemoryPlanFeatures.filter(
            p => !(String(p.planId) === monthlyPlanId && String(p.featureId) === String(featureProjects._id))
        );

        EntitlementService.clearAllCache();

        const status = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(status.allowed).toBe(false);
        expect(status.reason).toBe('PLAN_UPGRADE_REQUIRED');
        expect(status.limit).toBe(0);

        await expect(SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1)).rejects.toThrow();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 8: Single and bulk task creation enforces the task limit
    // ─────────────────────────────────────────────────────────────────────────
    it('8. Single and bulk task creation enforces task limit (e.g. 20 tasks/project)', async () => {
        // Populate 19 tasks for project
        for (let i = 0; i < 19; i++) {
            inMemoryTasks.push({ _id: new Types.ObjectId(), projectId: new Types.ObjectId(projectId), companyId: new Types.ObjectId(companyAId), isArchived: false });
        }

        // Single task (1) fits
        const singleAllowed = await SubscriptionQuotaService.checkQuota(companyAId, 'tasks', 1, { projectId });
        expect(singleAllowed.allowed).toBe(true);
        expect(singleAllowed.currentUsage).toBe(19);
        expect(singleAllowed.limit).toBe(20);

        // Bulk creation of 2 tasks exceeds limit (19 + 2 = 21 > 20)
        const bulkDenied = await SubscriptionQuotaService.checkQuota(companyAId, 'tasks', 2, { projectId });
        expect(bulkDenied.allowed).toBe(false);
        expect(bulkDenied.reason).toBe('PLAN_LIMIT_REACHED');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 9: Recurring task generation cannot bypass task limits
    // ─────────────────────────────────────────────────────────────────────────
    it('9. Recurring task generation cannot bypass task limits', async () => {
        // Populate 20 tasks (limit reached)
        for (let i = 0; i < 20; i++) {
            inMemoryTasks.push({ _id: new Types.ObjectId(), projectId: new Types.ObjectId(projectId), companyId: new Types.ObjectId(companyAId), isArchived: false });
        }

        // Attempting to reserve quota for a new recurring task instance fails
        await expect(
            SubscriptionQuotaService.reserveQuota(companyAId, 'tasks', 1, { projectId })
        ).rejects.toThrow(AppError);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 10: Member invitations and user reactivations enforce user limit
    // ─────────────────────────────────────────────────────────────────────────
    it('10. Member invitations and user reactivations enforce the user/seat limit (5 seats)', async () => {
        // 4 active members + 1 pending invitation = 5 seats (full capacity)
        for (let i = 0; i < 4; i++) {
            inMemoryMembers.push({ companyId: new Types.ObjectId(companyAId), userId: new Types.ObjectId(), status: 'ACTIVE' });
        }
        inMemoryInvitations.push({ companyId: new Types.ObjectId(companyAId), email: 'pending@example.com', status: 'PENDING' });

        const status = await SubscriptionQuotaService.checkQuota(companyAId, 'users', 1);
        expect(status.allowed).toBe(false);
        expect(status.reason).toBe('PLAN_LIMIT_REACHED');
        expect(status.currentUsage).toBe(5);
        expect(status.limit).toBe(5);

        // Trying to invite another user is blocked
        await expect(
            SubscriptionQuotaService.reserveQuota(companyAId, 'users', 1)
        ).rejects.toThrow(AppError);

        // Trying to reactivate a 5th deactivated member is blocked
        await expect(
            SubscriptionQuotaService.assertQuota(companyAId, 'users', 1)
        ).rejects.toThrow(AppError);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 11: Storage uploads exceeding GB limit are rejected before upload
    // ─────────────────────────────────────────────────────────────────────────
    it('11. Storage upload exceeding GB limit is rejected before persisting to storage provider', async () => {
        // Already used: 9.9 GB of 10 GB limit
        const usedBytes = 9.9 * 1024 * 1024 * 1024;
        inMemoryFiles.push({ companyId: new Types.ObjectId(companyAId), size: usedBytes, deletedAt: null });

        // Attempt to upload a 200 MB file (which would push total to 10.1 GB > 10 GB)
        const fileSizeBytes = 200 * 1024 * 1024;
        const mockFile: Express.Multer.File = {
            fieldname: 'file',
            originalname: 'video-report.mp4',
            encoding: '7bit',
            mimetype: 'video/mp4',
            size: fileSizeBytes,
            buffer: Buffer.from('dummy file content'),
            destination: '',
            filename: '',
            path: '',
            stream: null as any,
        };

        await expect(
            FileService.upload({
                file: mockFile,
                companyId: companyAId,
                userId,
                contextType: 'PROJECT',
            })
        ).rejects.toThrow(AppError);

        // Verify storage provider was NEVER called (fail fast before network/storage overhead)
        expect(mockStorageProvider.uploadFile).not.toHaveBeenCalled();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 12: Concurrent creation attempts cannot exceed the limit
    // ─────────────────────────────────────────────────────────────────────────
    it('12. Concurrent creation attempts cannot exceed limit (2 parallel requests with 1 remaining capacity)', async () => {
        // 9/10 projects exist. Remaining capacity = 1
        for (let i = 0; i < 9; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        // Two parallel reservation requests
        const results = await Promise.allSettled([
            SubscriptionQuotaService.reserveQuota(companyAId, 'projects', 1),
            SubscriptionQuotaService.reserveQuota(companyAId, 'projects', 1),
        ]);

        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');

        // Exactly 1 must succeed and 1 must be rejected with 403 PLAN_LIMIT_REACHED
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason.statusCode).toBe(403);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 13: Failed creation operations release reservations cleanly
    // ─────────────────────────────────────────────────────────────────────────
    it('13. Failed operations release reservations and rollback cleanly', async () => {
        for (let i = 0; i < 9; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        // Reserve 1
        const reservation = await SubscriptionQuotaService.reserveQuota(companyAId, 'projects', 1);
        expect(inMemoryReservations.length).toBe(1);

        // Capacity is now full (9 existing + 1 pending = 10)
        const fullCheck = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(fullCheck.allowed).toBe(false);

        // Operation fails and releases reservation
        await reservation.release();

        // Reservation deleted from active pending set
        expect(inMemoryReservations.length).toBe(0);

        // Capacity is immediately available again
        const recoveredCheck = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(recoveredCheck.allowed).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 14: Deletion releases capacity; restoration re-checks quota
    // ─────────────────────────────────────────────────────────────────────────
    it('14. Deleting a resource releases capacity; restoration re-checks quota', async () => {
        // 10 projects exist (full)
        for (let i = 0; i < 10; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        const fullCheck = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(fullCheck.allowed).toBe(false);

        // Soft-delete one project
        inMemoryProjects[0].deletedAt = new Date();

        // Deletion immediately releases capacity
        const afterDelete = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(afterDelete.allowed).toBe(true);
        expect(afterDelete.currentUsage).toBe(9);

        // Re-filling to 10
        inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });

        // Restoring the deleted project would exceed quota (10 + 1 = 11 > 10)
        await expect(
            SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1)
        ).rejects.toThrow(AppError);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 15: Cross-company requests are completely isolated
    // ─────────────────────────────────────────────────────────────────────────
    it('15. Cross-company requests are isolated (Company A limit does not impact Company B)', async () => {
        // Company A reaches limit (10/10)
        for (let i = 0; i < 10; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        const compACheck = await SubscriptionQuotaService.checkQuota(companyAId, 'projects', 1);
        expect(compACheck.allowed).toBe(false);

        // Company B has 0 projects on Annual plan (limit: 50)
        const compBCheck = await SubscriptionQuotaService.checkQuota(companyBId, 'projects', 1);
        expect(compBCheck.allowed).toBe(true);
        expect(compBCheck.currentUsage).toBe(0);
        expect(compBCheck.limit).toBe(50);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 16: Read access and unrelated features remain fully functional
    // ─────────────────────────────────────────────────────────────────────────
    it('16. Read access and unrelated features remain fully functional when limits are reached', async () => {
        // Company A has reached project limit (10/10)
        for (let i = 0; i < 10; i++) {
            inMemoryProjects.push({ _id: new Types.ObjectId(), companyId: new Types.ObjectId(companyAId), deletedAt: null });
        }

        // Express app to verify read vs creation endpoints
        const app = express();
        app.use(express.json());

        // GET projects list (read-only)
        app.get('/api/projects', async (req: Request, res: Response) => {
            const projects = inMemoryProjects.filter(p => String(p.companyId) === companyAId && !p.deletedAt);
            res.status(200).json({ success: true, count: projects.length, data: projects });
        });

        // POST project (quota-enforced)
        app.post('/api/projects', async (req: Request, res: Response) => {
            try {
                await SubscriptionQuotaService.assertQuota(companyAId, 'projects', 1);
                res.status(201).json({ success: true, message: 'Project created' });
            } catch (err: any) {
                res.status(err.statusCode || 500).json({
                    success: false,
                    message: err.message,
                    errors: err.errors,
                });
            }
        });

        // Read request succeeds with 200 OK
        const readRes = await request(app).get('/api/projects');
        expect(readRes.status).toBe(200);
        expect(readRes.body.count).toBe(10);

        // Create request fails with 403 and required standard error envelope
        const createRes = await request(app).post('/api/projects');
        expect(createRes.status).toBe(403);
        expect(createRes.body).toMatchObject({
            success: false,
            errors: {
                code: 'PLAN_LIMIT_REACHED',
                resource: 'projects',
                currentUsage: 10,
                limit: 10,
            },
        });
    });
});
