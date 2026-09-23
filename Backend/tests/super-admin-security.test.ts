import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { generateAccessToken } from '../src/utils/tokens';
import { AuthSession } from '../src/modules/auth/session/auth-session.model';
import { AuditLog } from '../src/modules/audit-logs/audit-log.model';
import { User } from '../src/modules/users/user.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/auth/session/auth-session.model', () => ({
    AuthSession: {
        find: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        find: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        countDocuments: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Security API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/security/summary - returns active sessions, failed logins, and MFA metrics', async () => {
        vi.mocked(AuthSession.countDocuments).mockResolvedValue(45 as any);
        vi.mocked(AuditLog.countDocuments)
            .mockResolvedValueOnce(3 as any)  // failed 24h
            .mockResolvedValueOnce(12 as any) // failed 7d
            .mockResolvedValueOnce(5 as any)  // events 24h
            .mockResolvedValueOnce(20 as any); // events 7d
        vi.mocked(User.countDocuments)
            .mockResolvedValueOnce(100 as any) // total users
            .mockResolvedValueOnce(60 as any);  // mfa users

        const res = await request(app)
            .get('/api/superadmin/security/summary')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.activeSessions).toBe(45);
        expect(res.body.data.failedLogins.last24Hours).toBe(3);
        expect(res.body.data.mfaAdoption.adoptionRate).toBe(60); // 60 / 100 * 100
        expect(res.body.data.securityEvents.last24Hours).toBe(5);
    });

    it('GET /api/superadmin/security/sessions - returns paginated session records', async () => {
        const mockSession = {
            _id: 'session_1',
            userId: { _id: 'user_1', name: 'Alice', email: 'alice@example.com', status: 'ACTIVE' },
            deviceId: 'dev_chrome_win',
            ipAddress: '192.168.1.10',
            userAgent: 'Mozilla/5.0...',
            lastUsedAt: new Date(),
            expiresAt: new Date(Date.now() + 86400000),
            mfaVerifiedAt: new Date(),
            revokedAt: null,
            createdAt: new Date(),
        };

        vi.mocked(AuthSession.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    skip: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([mockSession]),
                        }),
                    }),
                }),
            }),
        } as any);

        vi.mocked(AuthSession.countDocuments).mockResolvedValue(1 as any);

        const res = await request(app)
            .get('/api/superadmin/security/sessions?page=1&limit=10')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.sessions).toHaveLength(1);
        expect(res.body.data.sessions[0].user.name).toBe('Alice');
        expect(res.body.data.sessions[0].isRevoked).toBe(false);
    });

    it('GET /api/superadmin/security/events - returns paginated security audit events', async () => {
        const mockEvent = {
            _id: 'event_1',
            action: 'USER_LOGIN_FAILED',
            actorEmail: 'hacker@example.com',
            targetEmail: 'admin@worksphere.io',
            ipAddress: '10.0.0.1',
            success: false,
            description: 'Failed login attempt: Invalid password',
            createdAt: new Date(),
        };

        vi.mocked(AuditLog.find).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                skip: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue([mockEvent]),
                    }),
                }),
            }),
        } as any);

        vi.mocked(AuditLog.countDocuments).mockResolvedValue(1 as any);

        const res = await request(app)
            .get('/api/superadmin/security/events?page=1&limit=10')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.events).toHaveLength(1);
        expect(res.body.data.events[0].action).toBe('USER_LOGIN_FAILED');
        expect(res.body.data.events[0].success).toBe(false);
    });
});
