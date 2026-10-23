import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ALL_DEFINED_PERMISSIONS, seedPermissions } from '../src/database/seeds/seed-permissions';
import { seedRoles } from '../src/database/seeds/seed-roles';
import { seedSuperAdmin } from '../src/database/seeds/seed-super-admin';
import { SYSTEM_FEATURE_CATALOG, seedFeatures } from '../src/database/seeds/seed-features';
import { SEED_PLANS, seedPlans } from '../src/database/seeds/seed-plans';
import { seedSettings } from '../src/database/seeds/seed-settings';
import { Permission } from '../src/modules/permissions/permission.model';
import { Role } from '../src/modules/roles/role.model';
import { User } from '../src/modules/users/user.model';
import { Feature } from '../src/modules/super-admin/features/features.model';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { PlanFeature } from '../src/modules/super-admin/plan-features/plan-features.model';
import { StorageConfiguration } from '../src/modules/super-admin/storage/storage-config.model';
import { NotificationSound } from '../src/modules/notification-sounds/notification-sound.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { EntitlementService } from '../src/services/entitlement.service';

vi.mock('../src/modules/permissions/permission.model');
vi.mock('../src/modules/roles/role.model');
vi.mock('../src/modules/users/user.model');
vi.mock('../src/modules/super-admin/features/features.model');
vi.mock('../src/modules/super-admin/plans/plans.model');
vi.mock('../src/modules/super-admin/plan-features/plan-features.model');
vi.mock('../src/modules/super-admin/storage/storage-config.model');
vi.mock('../src/modules/notification-sounds/notification-sound.model');
vi.mock('../src/modules/super-admin/companies/company.model');
vi.mock('../src/modules/companyadmin/settings/company-settings.model');
vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: {
        clearAllCache: vi.fn(),
    },
}));

describe('Production Database Seeding & Initialization System', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.SUPER_ADMIN_EMAIL = 'superadmin@worksphere.com';
        process.env.SUPER_ADMIN_PASSWORD = 'StrongPassword123!';
    });

    // ── 1. Permissions Seed ───────────────────────────────────────────────────
    describe('Permissions Seeding', () => {
        it('should seed all defined permissions when none exist', async () => {
            vi.mocked(Permission.findOne).mockResolvedValue(null as any);
            vi.mocked(Permission.create).mockResolvedValue({} as any);

            const result = await seedPermissions(false);

            expect(result.created).toBe(ALL_DEFINED_PERMISSIONS.length);
            expect(result.updated).toBe(0);
            expect(result.total).toBe(ALL_DEFINED_PERMISSIONS.length);
            expect(Permission.create).toHaveBeenCalledTimes(ALL_DEFINED_PERMISSIONS.length);
        });

        it('should be idempotent and not create duplicate permissions when already present', async () => {
            // Simulate that all permissions already exist identically
            vi.mocked(Permission.findOne).mockImplementation((query: any) => {
                const target = ALL_DEFINED_PERMISSIONS.find((p) => p.name === query.name);
                if (target) {
                    return Promise.resolve({
                        _id: 'perm_id_123',
                        name: target.name,
                        description: target.description,
                        category: target.category,
                        scope: target.scope,
                        assignableBy: target.assignableBy,
                    } as any);
                }
                return Promise.resolve(null as any);
            });

            const result = await seedPermissions(false);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(0);
            expect(Permission.create).not.toHaveBeenCalled();
            expect(Permission.updateOne).not.toHaveBeenCalled();
        });
    });

    // ── 2. Roles Seed ─────────────────────────────────────────────────────────
    describe('Roles Seeding', () => {
        it('should create required roles and assign all appropriate permissions', async () => {
            vi.mocked(Permission.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: 'perm_1', name: 'COMPANY_CREATE', scope: 'SYSTEM' },
                    { _id: 'perm_2', name: 'DASHBOARD_READ', scope: 'COMPANY_MEMBER' },
                ]),
            } as any);

            vi.mocked(Role.findOne).mockResolvedValue(null as any);
            vi.mocked(Role.create).mockResolvedValue({} as any);

            const result = await seedRoles(false);

            expect(result.created).toBe(4); // SUPER_ADMIN, COMPANY_ADMIN, User, EMPLOYEE
            expect(result.updated).toBe(0);
            expect(Role.create).toHaveBeenCalledTimes(4);
        });

        it('should merge missing permissions without deleting existing customized permissions', async () => {
            vi.mocked(Permission.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: 'perm_1', name: 'COMPANY_CREATE', scope: 'SYSTEM' },
                    { _id: 'perm_2', name: 'DASHBOARD_READ', scope: 'COMPANY_MEMBER' },
                ]),
            } as any);

            const mockSave = vi.fn().mockResolvedValue(true);
            vi.mocked(Role.findOne).mockImplementation((query: any) =>
                Promise.resolve({
                    name: query.name,
                    permissions: ['perm_1'],
                    save: mockSave,
                } as any)
            );

            const result = await seedRoles(false);

            expect(result.created).toBe(0);
            expect(result.updated).toBe(4); // Each existing role gets missing perms merged
            expect(mockSave).toHaveBeenCalled();
        });
    });

    // ── 3. SuperAdmin Seed ────────────────────────────────────────────────────
    describe('SuperAdmin Seeding', () => {
        it('should provision fresh SuperAdmin when none exists', async () => {
            vi.mocked(Role.findOne).mockResolvedValue({ _id: 'role_super_admin' } as any);
            vi.mocked(User.findOne).mockImplementation(() => Promise.resolve(null as any));
            vi.mocked(User.create).mockResolvedValue({} as any);

            const result = await seedSuperAdmin(false);

            expect(result.created).toBe(true);
            expect(result.skipped).toBe(false);
            expect(result.email).toBe('superadmin@worksphere.com');
            expect(User.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: 'superadmin@worksphere.com',
                    role: 'role_super_admin',
                    isActive: true,
                    status: 'ACTIVE',
                })
            );
        });

        it('CRITICAL: must NEVER overwrite existing production password or user data', async () => {
            vi.mocked(Role.findOne).mockResolvedValue({ _id: 'role_super_admin' } as any);
            const mockSave = vi.fn();
            vi.mocked(User.findOne).mockImplementation((query: any) => {
                if (query.email) {
                    return Promise.resolve({
                        email: 'superadmin@worksphere.com',
                        password: '$argon2id$v=19$m=65536,t=3,p=4$existingSecretHash',
                        role: 'role_super_admin',
                        save: mockSave,
                    } as any);
                }
                return Promise.resolve(null as any);
            });

            const result = await seedSuperAdmin(false);

            expect(result.created).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.message).toContain('Retained existing production password without mutation');
            expect(User.create).not.toHaveBeenCalled();
            expect(mockSave).not.toHaveBeenCalled();
        });

        it('should skip creation if a SuperAdmin already exists with a different email', async () => {
            vi.mocked(Role.findOne).mockResolvedValue({ _id: 'role_super_admin' } as any);

            // First findOne checks for existing SuperAdmin by role
            vi.mocked(User.findOne).mockImplementation((query: any) => {
                if (query.role) {
                    return Promise.resolve({
                        email: 'active-admin@company.com',
                        role: 'role_super_admin',
                    } as any);
                }
                return Promise.resolve(null as any);
            });

            const result = await seedSuperAdmin(false);

            expect(result.created).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.message).toContain('A SuperAdmin account already exists');
            expect(User.create).not.toHaveBeenCalled();
        });
    });

    // ── 4. Feature Catalog Seed ───────────────────────────────────────────────
    describe('Feature Catalog Seeding', () => {
        it('should seed all 22 system features idempotently', async () => {
            vi.mocked(Feature.findOne).mockResolvedValue(null as any);
            vi.mocked(Feature.create).mockResolvedValue({} as any);

            const result = await seedFeatures(false);

            expect(result.created).toBe(SYSTEM_FEATURE_CATALOG.length);
            expect(result.total).toBe(SYSTEM_FEATURE_CATALOG.length);
            expect(Feature.create).toHaveBeenCalledTimes(SYSTEM_FEATURE_CATALOG.length);
        });
    });

    // ── 5. Subscription Plans & Entitlements ──────────────────────────────────
    describe('Subscription Plans & Entitlements Seeding', () => {
        it('should seed default Starter, Growth, and Enterprise plans with PlanFeature entitlements', async () => {
            vi.mocked(Feature.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: 'feat_users', key: 'USERS', type: 'LIMIT' },
                    { _id: 'feat_tasks', key: 'TASKS', type: 'LIMIT' },
                    { _id: 'feat_mgmt', key: 'TASK_MANAGEMENT', type: 'BOOLEAN' },
                ]),
            } as any);

            vi.mocked(Plan.findOne).mockResolvedValue(null as any);
            vi.mocked(Plan.create).mockImplementation((data: any) =>
                Promise.resolve({ _id: `plan_${data.code}`, ...data } as any)
            );
            vi.mocked(PlanFeature.updateOne).mockResolvedValue({} as any);

            const result = await seedPlans(false);

            expect(result.plansCreated).toBe(SEED_PLANS.length);
            expect(PlanFeature.updateOne).toHaveBeenCalled();
            expect(EntitlementService.clearAllCache).toHaveBeenCalled();
        });
    });

    // ── 6. Default Settings & Company Backfill ────────────────────────────────
    describe('Settings & Storage Seeding', () => {
        it('should initialize default storage and default notification sound if missing', async () => {
            vi.mocked(StorageConfiguration.findOne).mockResolvedValue(null as any);
            vi.mocked(StorageConfiguration.create).mockResolvedValue({} as any);

            vi.mocked(NotificationSound.findOne).mockResolvedValue(null as any);
            vi.mocked(NotificationSound.create).mockResolvedValue({} as any);

            vi.mocked(Company.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            } as any);

            const result = await seedSettings(false);

            expect(result.storageInitialized).toBe(true);
            expect(result.defaultSoundInitialized).toBe(true);
            expect(result.companySettingsBackfilled).toBe(0);
            expect(StorageConfiguration.create).toHaveBeenCalled();
            expect(NotificationSound.create).toHaveBeenCalled();
        });

        it('should backfill settings for existing companies without creating new companies or employees', async () => {
            vi.mocked(StorageConfiguration.findOne).mockResolvedValue({ _id: 'existing_storage' } as any);
            vi.mocked(NotificationSound.findOne).mockResolvedValue({ _id: 'existing_sound', isDefault: true } as any);

            vi.mocked(Company.find).mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: 'comp_1', name: 'Existing Acme Corp' },
                ]),
            } as any);

            vi.mocked(CompanySettings.findOne).mockResolvedValue(null as any);
            vi.mocked(CompanySettings.create).mockResolvedValue({} as any);

            const result = await seedSettings(false);

            expect(result.storageInitialized).toBe(false);
            expect(result.defaultSoundInitialized).toBe(false);
            expect(result.companySettingsBackfilled).toBe(1);
            expect(CompanySettings.create).toHaveBeenCalledWith(
                expect.objectContaining({ companyId: 'comp_1' })
            );
            // Non-transactional rule: Never create new companies or employees
            expect(Company.create).not.toHaveBeenCalled();
        });
    });
});
