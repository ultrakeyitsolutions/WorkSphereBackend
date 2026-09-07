import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authenticate } from '../src/middleware/auth.middleware';
import { authorizeRoles, authorizePermissions } from '../src/middleware/authorization.middleware';
import { generateAccessToken } from '../src/utils/tokens';
import { User } from '../src/modules/users/user.model';

vi.mock('../src/modules/users/user.model', () => {
    const UserMock = {
        find: vi.fn(),
        findById: vi.fn(),
    };
    return {
        User: UserMock,
        default: UserMock,
    };
});

// Setup mock test server
const appTest = express();
appTest.use(express.json());

appTest.get(
    '/admin-only',
    authenticate,
    authorizeRoles('Admin'),
    (req, res) => {
        res.status(200).json({ success: true, message: 'Welcome Admin' });
    }
);

appTest.get(
    '/write-users',
    authenticate,
    authorizePermissions('WRITE_USERS'),
    (req, res) => {
        res.status(200).json({ success: true, message: 'Permission Granted' });
    }
);

// We need to set env vars for tests to run without throwing configuration error during import
process.env.JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
process.env.MONGODB_URI = 'mongodb://localhost:27017/worksphere_test';

describe('Authorization Middleware', () => {
    let regularToken: string;
    let adminToken: string;

    beforeEach(() => {
        vi.clearAllMocks();

        regularToken = generateAccessToken({
            userId: 'user_regular',
            email: 'regular@example.com',
            role: 'User',
        });

        adminToken = generateAccessToken({
            userId: 'user_admin',
            email: 'admin@example.com',
            role: 'Admin',
        });

        // Default mock so authenticate() can resolve a valid active user for role-only tests.
        // Permission tests override this with their own mockReturnValue below.
        (User.findById as any).mockReturnValue({
            populate: vi.fn().mockResolvedValue({
                _id: 'user_default',
                isActive: true,
                role: { name: 'User', permissions: [] },
            }),
        });
    });

    describe('Role Authorization', () => {
        it('should block users who do not have the required role', async () => {
            const res = await request(appTest)
                .get('/admin-only')
                .set('Authorization', `Bearer ${regularToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Insufficient role permissions');
        });

        it('should allow users who have the required role', async () => {
            const res = await request(appTest)
                .get('/admin-only')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Welcome Admin');
        });
    });

    describe('Permission Authorization', () => {
        it('should allow Admin to bypass any permission check', async () => {
            const mockAdminUser = {
                _id: 'user_admin',
                isActive: true,
                role: {
                    name: 'Admin',
                    permissions: [],
                },
            };

            (User.findById as any).mockReturnValue({ populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(mockAdminUser).then(resolve); } });

            const res = await request(appTest)
                .get('/write-users')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Permission Granted');
        });

        it('should allow a regular user who has the required permission', async () => {
            const mockRegularUser = {
                _id: 'user_regular',
                isActive: true,
                role: {
                    name: 'User',
                    permissions: [
                        { name: 'WRITE_USERS' },
                    ],
                },
            };

            (User.findById as any).mockReturnValue({ populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(mockRegularUser).then(resolve); } });

            const res = await request(appTest)
                .get('/write-users')
                .set('Authorization', `Bearer ${regularToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toBe('Permission Granted');
        });

        it('should block a regular user who does not have the required permission', async () => {
            const mockRegularUserWithoutPerm = {
                _id: 'user_regular',
                isActive: true,
                role: {
                    name: 'User',
                    permissions: [
                        { name: 'READ_USERS' }, // doesn't have WRITE_USERS
                    ],
                },
            };

            (User.findById as any).mockReturnValue({ populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(mockRegularUserWithoutPerm).then(resolve); } });

            const res = await request(appTest)
                .get('/write-users')
                .set('Authorization', `Bearer ${regularToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Missing required permissions');
        });
    });
});

