import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { authenticate } from '../src/middleware/auth.middleware';
import { authorizeRoles, authorizePermissions } from '../src/middleware/authorization.middleware';
import { blockImpersonatedOperations } from '../src/middleware/impersonation.middleware';
import { generateAccessToken, generateRefreshToken } from '../src/utils/tokens';
import { ImpersonationSession } from '../src/modules/super-admin/impersonation/impersonation.model';
import { ImpersonationStatus } from '../src/modules/super-admin/impersonation/impersonation.types';
import { User } from '../src/modules/users/user.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { UserService } from '../src/modules/users/user.service';
import impersonationRoutes from '../src/modules/super-admin/impersonation/impersonation.routes';

// Mock mongoose models
vi.mock('../src/modules/users/user.model', () => {
    const UserMock = {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
    };
    return {
        User: UserMock,
        default: UserMock,
    };
});

vi.mock('../src/modules/users/user.service', () => {
    return {
        UserService: {
            findById: vi.fn(),
            findByEmail: vi.fn(),
            hasPermission: vi.fn(),
        },
    };
});

vi.mock('../src/modules/super-admin/companies/company.model', () => {
    const CompanyMock = {
        findById: vi.fn(),
        findOne: vi.fn(),
    };
    return {
        Company: CompanyMock,
        default: CompanyMock,
    };
});

vi.mock('../src/modules/super-admin/impersonation/impersonation.model', () => {
    class MockImpersonationSession {
        sessionId?: string;
        originalUserId?: any;
        targetUserId?: any;
        targetCompanyId?: any;
        status?: any;
        startedAt?: any;
        expiresAt?: any;
        ipAddress?: any;
        userAgent?: any;

        constructor(data: any) {
            Object.assign(this, data);
        }

        save() {
            return Promise.resolve(this);
        }

        static findOne = vi.fn();
        static find = vi.fn();
        static create = vi.fn();
        static updateOne = vi.fn();
    }

    return {
        ImpersonationSession: MockImpersonationSession,
        default: MockImpersonationSession,
    };
});


vi.mock('../src/modules/audit-logs/audit-log.service', () => {
    return {
        AuditLogService: {
            log: vi.fn().mockResolvedValue(undefined),
            getAll: vi.fn(),
            getById: vi.fn(),
        },
    };
});

vi.mock('../src/modules/auth/session/session.service', () => {
    return {
        SessionService: {
            createSession: vi.fn().mockResolvedValue({}),
            validateSession: vi.fn().mockResolvedValue({}),
            rotateSessionToken: vi.fn().mockResolvedValue({}),
            revokeSessionByToken: vi.fn().mockResolvedValue(true),
        },
    };
});

// Setup test Express App
const app = express();
app.use(express.json());

// Mount impersonation endpoints
app.use('/api/superadmin/impersonation', impersonationRoutes);

// Protected test endpoints
app.get('/api/test/super-admin-only', authenticate, authorizeRoles('SUPER_ADMIN'), (req, res) => {
    res.status(200).json({ success: true, message: 'Super Admin Access Granted' });
});

app.get('/api/test/employee-only', authenticate, authorizeRoles('EMPLOYEE'), (req, res) => {
    res.status(200).json({ success: true, message: 'Employee Access Granted' });
});

app.get('/api/test/write-timesheet', authenticate, authorizePermissions('TIMESHEET_WRITE'), (req, res) => {
    res.status(200).json({ success: true, message: 'Timesheet Write Granted' });
});

app.post('/api/test/sensitive-mfa', authenticate, blockImpersonatedOperations(), (req, res) => {
    res.status(200).json({ success: true, message: 'MFA Updated' });
});

describe('Super Admin Impersonation System', () => {
    const superAdminId = new Types.ObjectId().toString();
    const companyAdminId = new Types.ObjectId().toString();
    const employeeId = new Types.ObjectId().toString();
    const targetCompanyId = new Types.ObjectId().toString();
    const mockSessionId = 'sess-12345-uuid';

    let superAdminToken: string;
    let companyAdminToken: string;
    let employeeToken: string;
    let impersonatedEmployeeToken: string;

    const mockSuperAdminUser = {
        _id: new Types.ObjectId(superAdminId),
        name: 'Root Super Admin',
        email: 'superadmin@worksphere.com',
        isActive: true,
        status: 'ACTIVE',
        role: { name: 'SUPER_ADMIN', permissions: [] },
    };

    const mockCompanyAdminUser = {
        _id: new Types.ObjectId(companyAdminId),
        name: 'Acme Admin',
        email: 'admin@acme.com',
        isActive: true,
        status: 'ACTIVE',
        companyId: new Types.ObjectId(targetCompanyId),
        role: { name: 'COMPANY_ADMIN', permissions: [] },
    };

    const mockEmployeeUser = {
        _id: new Types.ObjectId(employeeId),
        name: 'John Employee',
        email: 'john@acme.com',
        isActive: true,
        status: 'ACTIVE',
        companyId: new Types.ObjectId(targetCompanyId),
        role: {
            name: 'EMPLOYEE',
            permissions: [{ name: 'TIMESHEET_WRITE' }],
        },
    };

    const mockCompany = {
        _id: new Types.ObjectId(targetCompanyId),
        name: 'Acme Corp',
        isActive: true,
        status: 'ACTIVE',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        superAdminToken = generateAccessToken({
            userId: superAdminId,
            email: 'superadmin@worksphere.com',
            role: 'SUPER_ADMIN',
            sub: superAdminId,
        });

        companyAdminToken = generateAccessToken({
            userId: companyAdminId,
            email: 'admin@acme.com',
            role: 'COMPANY_ADMIN',
            companyId: targetCompanyId,
            sub: companyAdminId,
        });

        employeeToken = generateAccessToken({
            userId: employeeId,
            email: 'john@acme.com',
            role: 'EMPLOYEE',
            companyId: targetCompanyId,
            sub: employeeId,
        });

        impersonatedEmployeeToken = generateAccessToken({
            userId: employeeId,
            email: 'john@acme.com',
            role: 'EMPLOYEE',
            companyId: targetCompanyId,
            sub: employeeId,
            authUserId: superAdminId,
            effectiveUserId: employeeId,
            sessionUserId: superAdminId,
            isImpersonating: true,
            impersonationSessionId: mockSessionId,
            sessionType: 'IMPERSONATION',
            impersonatedBy: superAdminId,
        });

        // Default User lookup mocks
        (UserService.findById as any).mockImplementation((id: string) => {
            if (id === superAdminId) return Promise.resolve(mockSuperAdminUser);
            if (id === companyAdminId) return Promise.resolve(mockCompanyAdminUser);
            if (id === employeeId) return Promise.resolve(mockEmployeeUser);
            return Promise.resolve(null);
        });

        (User.findById as any).mockImplementation((id: any) => {
            const idStr = String(id);
            let foundUser: any = null;
            if (idStr === superAdminId) foundUser = mockSuperAdminUser;
            else if (idStr === companyAdminId) foundUser = mockCompanyAdminUser;
            else if (idStr === employeeId) foundUser = mockEmployeeUser;

            return {
                populate: vi.fn().mockResolvedValue(foundUser),
                then: (resolve: any) => Promise.resolve(foundUser).then(resolve),
            };
        });

        (Company.findById as any).mockResolvedValue(mockCompany);

        (ImpersonationSession.findOne as any).mockImplementation((query: any) => {
            if (query.sessionId === mockSessionId || query.status === ImpersonationStatus.ACTIVE) {
                return Promise.resolve({
                    sessionId: mockSessionId,
                    originalUserId: new Types.ObjectId(superAdminId),
                    targetUserId: new Types.ObjectId(employeeId),
                    targetCompanyId: new Types.ObjectId(targetCompanyId),
                    status: ImpersonationStatus.ACTIVE,
                    startedAt: new Date(),
                    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                    save: vi.fn().mockResolvedValue(true),
                });
            }
            return Promise.resolve(null);
        });
    });

    // ── 1. Authorization Tests ────────────────────────────────────────────────
    describe('1. Authorization Restrictions', () => {
        it('allows SUPER_ADMIN to start impersonation', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ targetUserId: employeeId });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isImpersonating).toBe(true);
            expect(res.body.data.authenticatedUserId).toBe(superAdminId);
            expect(res.body.data.impersonatedUserId).toBe(employeeId);
            expect(res.body.data.role).toBe('EMPLOYEE');
            expect(res.body.data.accessToken).toBeDefined();
        });

        it('denies Company Admin from starting impersonation (403)', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({ targetUserId: employeeId });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Only Super Admin can impersonate users');
        });

        it('denies Employee from starting impersonation (403)', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ targetUserId: companyAdminId });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Only Super Admin can impersonate users');
        });

        it('denies Unauthenticated requests (401)', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .send({ targetUserId: employeeId });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });
    });

    // ── 2. Target Validation Tests ───────────────────────────────────────────
    describe('2. Target User Validation', () => {
        it('returns 404 if target user does not exist', async () => {
            const nonExistentId = new Types.ObjectId().toString();
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ targetUserId: nonExistentId });

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Target user not found');
        });

        it('returns 403 if target user is inactive/deactivated', async () => {
            (UserService.findById as any).mockImplementation((id: string) => {
                if (id === superAdminId) return Promise.resolve(mockSuperAdminUser);
                if (id === employeeId) return Promise.resolve({ ...mockEmployeeUser, isActive: false });
                return Promise.resolve(null);
            });

            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ targetUserId: employeeId });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Target user is inactive');
        });
    });

    // ── 3. Session Lifecycle & Security ──────────────────────────────────────
    describe('3. Session Lifecycle & Authoritative Session Checks', () => {
        it('prevents nested impersonation (409 Conflict)', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/start')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`)
                .send({ targetUserId: companyAdminId });

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Nested impersonation is not allowed');
        });

        it('retrieves active impersonation details on GET /current', async () => {
            const res = await request(app)
                .get('/api/superadmin/impersonation/current')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isImpersonating).toBe(true);
            expect(res.body.data.originalUser.id).toBe(superAdminId);
            expect(res.body.data.targetUser.id).toBe(employeeId);
            expect(res.body.data.company.id).toBe(targetCompanyId);
        });

        it('returns isImpersonating=false on GET /current for normal user', async () => {
            const res = await request(app)
                .get('/api/superadmin/impersonation/current')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isImpersonating).toBe(false);
        });

        it('stops impersonation and restores Super Admin tokens on POST /stop', async () => {
            const res = await request(app)
                .post('/api/superadmin/impersonation/stop')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.isImpersonating).toBe(false);
            expect(res.body.data.user.role).toBe('SUPER_ADMIN');
            expect(res.body.data.accessToken).toBeDefined();
        });

        it('rejects impersonation token if session in DB has ENDED (401)', async () => {
            (ImpersonationSession.findOne as any).mockResolvedValue({
                sessionId: mockSessionId,
                status: ImpersonationStatus.ENDED,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            });

            const res = await request(app)
                .get('/api/test/employee-only')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Impersonation session has ended');
        });

        it('rejects impersonation token if session in DB has EXPIRED (401)', async () => {
            const mockSave = vi.fn().mockResolvedValue(true);
            (ImpersonationSession.findOne as any).mockResolvedValue({
                sessionId: mockSessionId,
                status: ImpersonationStatus.ACTIVE,
                expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
                save: mockSave,
            });

            const res = await request(app)
                .get('/api/test/employee-only')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Impersonation session has expired');
        });
    });

    // ── 4. Role & Permission Isolation ───────────────────────────────────────
    describe('4. Role & Permission Isolation', () => {
        it('allows impersonated Employee to access Employee-scoped routes', async () => {
            const res = await request(app)
                .get('/api/test/employee-only')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Employee Access Granted');
        });

        it('blocks impersonated Employee from accessing Super Admin routes (403)', async () => {
            const res = await request(app)
                .get('/api/test/super-admin-only')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Insufficient role permissions');
        });

        it('evaluates effective permissions of the target user', async () => {
            const res = await request(app)
                .get('/api/test/write-timesheet')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Timesheet Write Granted');
        });
    });

    // ── 5. Dangerous Operations Protection ───────────────────────────────────
    describe('5. Dangerous Operations Guard', () => {
        it('blocks sensitive operations while impersonating (403 Forbidden)', async () => {
            const res = await request(app)
                .post('/api/test/sensitive-mfa')
                .set('Authorization', `Bearer ${impersonatedEmployeeToken}`)
                .send({ action: 'DISABLE_MFA' });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('This operation is not allowed during impersonation');
        });

        it('allows normal authenticated users to perform sensitive operations', async () => {
            const res = await request(app)
                .post('/api/test/sensitive-mfa')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ action: 'SETUP_MFA' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('MFA Updated');
        });
    });
});
