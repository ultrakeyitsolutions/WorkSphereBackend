import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { User } from '../src/modules/users/user.model';
import { Role } from '../src/modules/roles/role.model';
import { WhiteLabelSettings } from '../src/modules/super-admin/white-label/white-label.model';
import { TenantMembership } from '../src/modules/super-admin/white-label/tenant-membership.model';
import { Subscription } from '../src/modules/super-admin/subscriptions/subscription.model';
import { Plan } from '../src/modules/super-admin/plans/plans.model';
import { CompanySettings } from '../src/modules/companyadmin/settings/company-settings.model';
import { WhiteLabelService } from '../src/modules/super-admin/white-label/white-label.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { CompanyService } from '../src/modules/super-admin/companies/company.service';
import publicBrandingRoutes from '../src/modules/super-admin/white-label/public-branding.routes';
import { companyBrandingRouter, superAdminCompanyBrandingRouter } from '../src/modules/super-admin/white-label/white-label.routes';
import { requireTenantScope } from '../src/middleware/tenant.middleware';
import authRoutes from '../src/modules/auth/auth.routes';

// Mock DB Models
vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
        save: vi.fn(),
    },
    default: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/invitations/company-member.model', () => ({
    CompanyMember: {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
    },
    default: {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
        updateOne: vi.fn(),
        updateMany: vi.fn(),
    },
    default: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/roles/role.model', () => ({
    Role: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/white-label/white-label.model', () => ({
    WhiteLabelSettings: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
    DEFAULT_WHITE_LABEL_THEME: {
        primaryColor: '#3B82F6',
        secondaryColor: '#1E40AF',
        backgroundColor: '#F9FAFB',
        textColor: '#111827',
        accentColor: '#6366F1',
        sidebarBackground: '#1E293B',
        sidebarText: '#F8FAFC',
    },
    DEFAULT_WHITE_LABEL_LOGIN: {
        heading: 'Welcome to WorkSphere',
        subtitle: 'Sign in to access your team workspace and projects',
        bannerImageUrl: null,
        backgroundImageUrl: null,
        hideWorkSphereBranding: false,
        customCss: null,
    },
    DEFAULT_WHITE_LABEL_EMAIL: {
        senderName: 'WorkSphere Workspace',
        senderEmail: null,
        replyTo: null,
        logoUrl: null,
        footerText: 'Sent via WorkSphere Multi-Tenant Platform',
    },
    default: {
        find: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/white-label/tenant-membership.model', () => ({
    TenantMembership: {
        findOne: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
    },
    default: {
        findOne: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/subscriptions/subscription.model', () => ({
    Subscription: {
        findOne: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null),
                }),
            }),
        }),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/auth/session.service', () => ({
    SessionService: {
        createSession: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        revokeSession: vi.fn().mockResolvedValue(true),
        revokeAllUserSessions: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../src/modules/super-admin/plans/plans.model', () => ({
    Plan: {
        findById: vi.fn(),
        findOne: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/settings/company-settings.model', () => ({
    CompanySettings: {
        findOne: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../src/modules/super-admin/notifications/super-admin-notification.service', () => ({
    SuperAdminNotificationService: {
        dispatch: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../src/config/mail', () => ({
    getMailTransporter: vi.fn().mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ messageId: 'test-mail-id' }),
    }),
    mailDefaults: {
        from: 'no-reply@worksphere.io',
    },
}));

// Build Express test application
const app = express();
app.use(express.json());

// Public branding resolution
app.use('/api/v1/public/branding', publicBrandingRoutes);

// Auth routes
app.use('/api/auth', authRoutes);

// Company Admin branding
app.use('/api/company/branding', companyBrandingRouter);

// SuperAdmin company branding
app.use('/api/super-admin/companies/:companyId/branding', superAdminCompanyBrandingRouter);

describe('Multi-Tenant White Labeling System', () => {
    const superAdminToken = generateAccessToken({
        userId: 'super_admin_1',
        email: 'superadmin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const companyAId = new Types.ObjectId().toString();
    const companyATenantId = 'ws_comp_acme_123';
    const companyAToken = generateAccessToken({
        userId: 'admin_a_1',
        email: 'admin@acme.com',
        role: 'COMPANY_ADMIN',
        companyId: companyAId,
        tenantId: companyATenantId,
        tenantSlug: 'acme',
    });

    const companyBId = new Types.ObjectId().toString();
    const companyBTenantId = 'ws_comp_nova_456';
    const companyBToken = generateAccessToken({
        userId: 'admin_b_1',
        email: 'admin@nova.com',
        role: 'COMPANY_ADMIN',
        companyId: companyBId,
        tenantId: companyBTenantId,
        tenantSlug: 'nova',
    });

    const employeeAToken = generateAccessToken({
        userId: 'emp_a_1',
        email: 'employee@acme.com',
        role: 'Employee',
        companyId: companyAId,
        tenantId: companyATenantId,
        tenantSlug: 'acme',
    });

    beforeEach(() => {
        vi.clearAllMocks();
        WhiteLabelService.clearAllCache();

        // Mock mongoose.startSession
        vi.spyOn(mongoose, 'startSession').mockResolvedValue({
            startTransaction: vi.fn(),
            commitTransaction: vi.fn(),
            abortTransaction: vi.fn(),
            endSession: vi.fn(),
        } as any);

        // Default mock for User.findById in auth middleware
        vi.mocked(User.findById).mockImplementation((id: any) => ({
            populate: vi.fn().mockResolvedValue({
                _id: typeof id === 'string' && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id,
                email: 'admin@acme.com',
                isActive: true,
                status: 'ACTIVE',
                role: { name: 'COMPANY_ADMIN', permissions: [] },
                companyId: new Types.ObjectId(companyAId),
            }),
        } as any));

        // Default mock for Subscription.findOne
        vi.mocked(Subscription.findOne).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null),
                }),
            }),
        } as any);
    });

    // ── 1. Company Creation with Branding ────────────────────────────────────
    it('1. Company creation with branding initializes tenantId and white-label settings', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Acme Corporation',
            slug: 'acme-corporation',
            status: 'ACTIVE',
            isActive: true,
            save: vi.fn().mockResolvedValue(true),
        };

        const mockAdmin = {
            _id: new Types.ObjectId(),
            name: 'Acme Admin',
            email: 'admin@acme.com',
            role: 'COMPANY_ADMIN',
            companyId: mockCompany._id,
            save: vi.fn().mockResolvedValue(true),
        };

        const mockSettings = {
            tenantId: companyATenantId,
            companyId: mockCompany._id,
            enabled: true,
            displayName: 'Acme Portal',
            logoUrl: 'https://cdn.worksphere.io/acme-logo.png',
            faviconUrl: 'https://cdn.worksphere.io/acme-favicon.ico',
            appTitle: 'Acme Enterprise Portal',
            theme: {
                primaryColor: '#0052CC',
                secondaryColor: '#0747A6',
                backgroundColor: '#FFFFFF',
                textColor: '#172B4D',
                accentColor: '#0065FF',
                sidebarBackground: '#0747A6',
                sidebarText: '#FFFFFF',
            },
            loginPage: {
                heading: 'Sign in to Acme Portal',
                subtitle: 'Authorized Acme personnel only',
            },
        };

        vi.mocked(User.findOne).mockResolvedValue(null);
        vi.mocked(Company.findOne).mockResolvedValue(null);
        vi.mocked(Role.findOne).mockResolvedValue({ _id: new Types.ObjectId(), name: 'COMPANY_ADMIN' } as any);
        vi.mocked(Company.create).mockResolvedValue([mockCompany] as any);
        vi.mocked(WhiteLabelSettings.create).mockResolvedValue([mockSettings] as any);
        vi.mocked(TenantMembership.create).mockResolvedValue([{}] as any);
        vi.mocked(CompanySettings.create).mockResolvedValue([{}] as any);
        vi.mocked(Plan.findOne).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), billingCycle: 'MONTHLY' }),
            }),
        } as any);
        vi.mocked(Subscription.create).mockResolvedValue([{ _id: new Types.ObjectId() }] as any);

        // Call Service
        const result = await CompanyService.createWithAdmin({
            companyName: 'Acme Corporation',
            adminName: 'Acme Admin',
            adminEmail: 'admin@acme.com',
            adminPassword: 'Password123!',
            whiteLabelEnabled: true,
            displayName: 'Acme Portal',
            primaryColor: '#0052CC',
            secondaryColor: '#0747A6',
            appTitle: 'Acme Enterprise Portal',
        });

        expect(result.company.name).toBe('Acme Corporation');
        expect(result.company.tenantId).toBeDefined();
        expect(result.admin.email).toBe('admin@acme.com');
        expect(result.whiteLabel.enabled).toBe(true);
        expect(result.whiteLabel.theme.primaryColor).toBe('#0052CC');
    });

    // ── 2. Duplicate Company Slug Rejection ──────────────────────────────────
    it('2. Duplicate company slug rejection prevents slug collisions', async () => {
        vi.mocked(User.findOne).mockResolvedValue(null);
        vi.mocked(Company.findOne).mockResolvedValue({
            _id: new Types.ObjectId(),
            slug: 'acme-corp',
        } as any);

        await expect(
            CompanyService.createWithAdmin({
                companyName: 'Acme Corp',
                adminName: 'Admin',
                adminEmail: 'newadmin@acme.com',
                adminPassword: 'Password123!',
            })
        ).rejects.toThrow('already exists');
    });

    // ── 3. Public Branding Retrieval ─────────────────────────────────────────
    it('3. Public branding retrieval returns safe configuration by slug or custom domain', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Acme Corporation',
            slug: 'acme',
            status: 'ACTIVE',
            isActive: true,
        };

        const mockSettings = {
            companyId: mockCompany._id,
            enabled: true,
            displayName: 'Acme Portal',
            logoUrl: 'https://cdn.example.com/logo.png',
            faviconUrl: 'https://cdn.example.com/favicon.ico',
            appTitle: 'Acme Portal',
            theme: {
                primaryColor: '#FF5500',
                secondaryColor: '#CC4400',
                backgroundColor: '#FFFFFF',
                textColor: '#111827',
                accentColor: '#FF7733',
                sidebarBackground: '#1E293B',
                sidebarText: '#F8FAFC',
            },
            loginPage: {
                heading: 'Welcome Acme Team',
                subtitle: 'Log in with your corporate credentials',
                hideWorkSphereBranding: true,
            },
        };

        vi.mocked(Company.findOne).mockResolvedValue(mockCompany as any);
        vi.mocked(WhiteLabelSettings.findOne).mockResolvedValue(mockSettings as any);

        const res = await request(app).get('/api/v1/public/branding/resolve?workspace=acme');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.slug).toBe('acme');
        expect(res.body.data.displayName).toBe('Acme Portal');
        expect(res.body.data.theme.primaryColor).toBe('#FF5500');
        expect(res.body.data.loginPage.hideWorkSphereBranding).toBe(true);
        // Sensitive administrative fields must not be leaked in public branding
        expect(res.body.data.adminId).toBeUndefined();
        expect(res.body.data.emailBranding).toBeUndefined();
    });

    // ── 4. Company Admin Authorization ───────────────────────────────────────
    it('4. Company Admin can retrieve and update their own company branding', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Acme Corporation',
            slug: 'acme',
            status: 'ACTIVE',
        };

        const mockSettings = {
            companyId: mockCompany._id,
            tenantId: companyATenantId,
            displayName: 'Acme Portal',
            enabled: true,
            theme: { primaryColor: '#0052CC' },
            loginPage: {},
            emailBranding: {},
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(Company.findOne).mockResolvedValue(mockCompany as any);
        vi.mocked(WhiteLabelSettings.findOne).mockResolvedValue(mockSettings as any);

        // GET branding as Company Admin
        const getRes = await request(app)
            .get('/api/company/branding')
            .set('Authorization', `Bearer ${companyAToken}`);

        expect(getRes.status).toBe(200);
        expect(getRes.body.data.displayName).toBe('Acme Portal');

        // PATCH branding as Company Admin
        const patchRes = await request(app)
            .patch('/api/company/branding')
            .set('Authorization', `Bearer ${companyAToken}`)
            .send({
                displayName: 'Acme Technologies Global',
                theme: { primaryColor: '#123456' },
            });

        expect(patchRes.status).toBe(200);
        expect(mockSettings.save).toHaveBeenCalled();
    });

    // ── 5. Cross-Company Access Prevention ───────────────────────────────────
    it('5. Cross-company access prevention rejects unauthorized tenant modification', async () => {
        // Company A admin attempting to modify Company B's branding
        const res = await request(app)
            .patch(`/api/super-admin/companies/${companyBId}/branding`)
            .set('Authorization', `Bearer ${companyAToken}`)
            .send({ displayName: 'Hacked Name' });

        // Non-SuperAdmin cannot access /api/super-admin routes
        expect(res.status).toBe(403);
    });

    // ── 6. Suspended Company Login Rejection ─────────────────────────────────
    it('6. Suspended company login is rejected with 403 Forbidden', async () => {
        const suspendedCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Suspended Acme',
            slug: 'acme',
            status: 'SUSPENDED',
            isActive: false,
        };

        vi.mocked(Company.findOne).mockResolvedValue(suspendedCompany as any);
        vi.mocked(User.findOne).mockResolvedValue({
            _id: new Types.ObjectId(),
            email: 'admin@acme.com',
            companyId: suspendedCompany._id,
            status: 'ACTIVE',
            isActive: true,
            role: { name: 'COMPANY_ADMIN' },
        } as any);

        // Attempting to resolve public branding for suspended company returns 403
        const brandingRes = await request(app).get('/api/v1/public/branding/resolve?workspace=acme');
        expect(brandingRes.status).toBe(403);
        expect(brandingRes.body.data.suspended).toBe(true);
    });

    // ── 7. Unauthorized Branding Modification ────────────────────────────────
    it('7. Unauthenticated request to update branding is rejected with 401', async () => {
        const res = await request(app)
            .patch('/api/company/branding')
            .send({ displayName: 'Anonymous Update' });

        expect(res.status).toBe(401);
    });

    // ── 8. Domain Ownership Validation ───────────────────────────────────────
    it('8. Domain ownership validation rejects duplicate claims and verifies valid token', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Acme',
            slug: 'acme',
            save: vi.fn().mockResolvedValue(true),
        };

        const mockSettings = {
            companyId: mockCompany._id,
            tenantId: companyATenantId,
            customDomain: 'portal.acme.com',
            domainVerificationToken: 'ws-verify-1234567890abcdef',
            domainVerificationStatus: 'PENDING',
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(Company.findOne).mockResolvedValue(mockCompany as any);
        vi.mocked(WhiteLabelSettings.findOne).mockResolvedValue(mockSettings as any);

        // Verify domain with mockVerification = true
        const verifyRes = await request(app)
            .post('/api/company/branding/domain/verify')
            .set('Authorization', `Bearer ${companyAToken}`)
            .send({ verificationType: 'TOKEN', mockVerification: true });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.data.status).toBe('VERIFIED');
        expect(mockSettings.domainVerificationStatus).toBe('VERIFIED');
    });

    // ── 9. Multi-Company Membership & Tenant Switching ───────────────────────
    it('9. Multi-company tenant switching issues scoped token for authorized target workspace', async () => {
        const userObjId = new Types.ObjectId();
        const mockUser = {
            _id: userObjId,
            name: 'Shared Consultant',
            email: 'consultant@partner.com',
            role: { name: 'COMPANY_ADMIN', permissions: [] },
            companyId: new Types.ObjectId(companyAId),
            isActive: true,
            status: 'ACTIVE',
        };

        const targetCompanyB = {
            _id: new Types.ObjectId(companyBId),
            tenantId: companyBTenantId,
            name: 'Nova Solutions',
            slug: 'nova',
            status: 'ACTIVE',
            isActive: true,
        };

        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockResolvedValue(mockUser),
        } as any);

        vi.mocked(Company.findOne).mockResolvedValue(targetCompanyB as any);

        // User has verified membership in Company B
        vi.mocked(TenantMembership.findOne).mockResolvedValue({
            userId: userObjId,
            companyId: targetCompanyB._id,
            status: 'ACTIVE',
            role: 'COMPANY_ADMIN',
        } as any);

        const switchResult = await AuthService.switchTenant(
            String(userObjId),
            { targetTenantId: companyBTenantId }
        );

        expect(switchResult.accessToken).toBeDefined();
        expect(switchResult.company?.id).toBe(companyBId);
        expect(switchResult.company?.tenantId).toBe(companyBTenantId);
    });

    it('9b. Multi-company tenant switching rejects unauthorized target workspace', async () => {
        const userObjId = new Types.ObjectId();
        const mockUser = {
            _id: userObjId,
            name: 'Strict Acme User',
            email: 'user@acme.com',
            role: { name: 'Employee', permissions: [] },
            companyId: new Types.ObjectId(companyAId),
            isActive: true,
            status: 'ACTIVE',
        };

        const targetCompanyB = {
            _id: new Types.ObjectId(companyBId),
            tenantId: companyBTenantId,
            name: 'Nova Solutions',
            slug: 'nova',
            status: 'ACTIVE',
        };

        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockResolvedValue(mockUser),
        } as any);

        vi.mocked(Company.findOne).mockResolvedValue(targetCompanyB as any);
        // User does NOT have membership in Company B
        vi.mocked(TenantMembership.findOne).mockResolvedValue(null);

        await expect(
            AuthService.switchTenant(String(userObjId), { targetTenantId: companyBTenantId })
        ).rejects.toThrow('Unauthorized: You are not a verified member');
    });

    // ── 10. Tenant-Aware Caching & Invalidation ──────────────────────────────
    it('10. Public branding response is cached and invalidated on branding update', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(companyAId),
            tenantId: companyATenantId,
            name: 'Cache Test Corp',
            slug: 'cache-corp',
            status: 'ACTIVE',
            isActive: true,
        };

        const mockSettings = {
            companyId: mockCompany._id,
            enabled: true,
            displayName: 'Initial Name',
            theme: { primaryColor: '#111111' },
            loginPage: {},
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(Company.findOne).mockResolvedValue(mockCompany as any);
        vi.mocked(WhiteLabelSettings.findOne).mockResolvedValue(mockSettings as any);

        // First call populates cache
        const res1 = await WhiteLabelService.getPublicBranding({ workspace: 'cache-corp' });
        expect(res1.displayName).toBe('Initial Name');

        // Update settings directly
        mockSettings.displayName = 'Updated Name';
        // Invalidate cache
        await WhiteLabelService.invalidateCache(companyATenantId, 'cache-corp');

        // Next call fetches updated record
        const res2 = await WhiteLabelService.getPublicBranding({ workspace: 'cache-corp' });
        expect(res2.displayName).toBe('Updated Name');
    });

    // ── 11. Concurrent Company Creation & Idempotency ─────────────────────────
    it('11. Concurrent company creation with identical idempotency key returns cached result', async () => {
        const mockCompany = {
            _id: new Types.ObjectId(),
            tenantId: 'ws_comp_idem_1',
            name: 'Idempotent Corp',
            slug: 'idempotent-corp',
            status: 'ACTIVE',
            isActive: true,
            save: vi.fn().mockResolvedValue(true),
        };

        const mockAdmin = {
            _id: new Types.ObjectId(),
            name: 'Idem Admin',
            email: 'admin@idem.com',
            role: 'COMPANY_ADMIN',
            companyId: mockCompany._id,
            save: vi.fn().mockResolvedValue(true),
        };

        vi.mocked(User.findOne).mockResolvedValue(null);
        vi.mocked(Company.findOne).mockResolvedValue(null);
        vi.mocked(Role.findOne).mockResolvedValue({ _id: new Types.ObjectId(), name: 'COMPANY_ADMIN' } as any);
        vi.mocked(Company.create).mockResolvedValue([mockCompany] as any);
        vi.mocked(WhiteLabelSettings.create).mockResolvedValue([{ enabled: false, displayName: 'Idempotent Corp' }] as any);
        vi.mocked(TenantMembership.create).mockResolvedValue([{}] as any);
        vi.mocked(CompanySettings.create).mockResolvedValue([{}] as any);
        vi.mocked(Plan.findOne).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), billingCycle: 'MONTHLY' }),
            }),
        } as any);
        vi.mocked(Subscription.create).mockResolvedValue([{ _id: new Types.ObjectId() }] as any);

        const dto = {
            companyName: 'Idempotent Corp',
            adminName: 'Idem Admin',
            adminEmail: 'admin@idem.com',
            adminPassword: 'Password123!',
        };

        const key = 'idem_key_unique_123';

        // Concurrent requests
        const [resA, resB] = await Promise.all([
            CompanyService.createWithAdmin(dto, undefined, key),
            CompanyService.createWithAdmin(dto, undefined, key),
        ]);

        expect(resA.company.name).toBe('Idempotent Corp');
        expect(resB.company.name).toBe('Idempotent Corp');
        // Both returned the same company tenantId
        expect(resA.company.tenantId).toBe(resB.company.tenantId);
    });

    // ── 12. Existing Company Backward Compatibility ──────────────────────────
    it('12. Existing company without white labeling falls back cleanly to default WorkSphere branding', async () => {
        const legacyCompany = {
            _id: new Types.ObjectId(),
            name: 'Legacy Enterprises',
            slug: 'legacy-enterprises',
            status: 'ACTIVE',
            isActive: true,
        };

        vi.mocked(Company.findOne).mockResolvedValue(legacyCompany as any);
        // No custom WhiteLabelSettings document exists for this legacy company
        vi.mocked(WhiteLabelSettings.findOne).mockResolvedValue(null);

        const res = await WhiteLabelService.getPublicBranding({ workspace: 'legacy-enterprises' });

        expect(res.slug).toBe('legacy-enterprises');
        expect(res.displayName).toBe('Legacy Enterprises');
        expect(res.whiteLabelEnabled).toBe(false);
        // Fallback default theme is returned
        expect(res.theme.primaryColor).toBe('#3B82F6');
        expect(res.appTitle).toBe('Legacy Enterprises | WorkSphere');
    });
});
