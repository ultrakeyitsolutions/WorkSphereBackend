import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { User } from '../src/modules/users/user.model';
import { Role } from '../src/modules/roles/role.model';

vi.mock('../src/modules/users/user.model', () => {
    class MockUser {
        _id = 'user_123';
        name = 'Test User';
        email = 'test@example.com';
        password = 'hashed_password';
        role = {
            _id: 'role_123',
            name: 'User',
            permissions: [] as any[],
        };
        isActive = true;

        constructor(data?: any) {
            if (data) {
                Object.assign(this, data);
            }
        }

        async save() {
            return this;
        }

        static findOne = vi.fn();
        static findById = vi.fn();
    }

    return {
        User: MockUser,
        default: MockUser,
    };
});

vi.mock('../src/modules/roles/role.model', () => {
    class MockRole {
        _id = 'role_123';
        name = 'User';
        permissions = [] as any[];

        constructor(data?: any) {
            if (data) {
                Object.assign(this, data);
            }
        }

        async save() {
            return this;
        }

        static findOne = vi.fn();
    }

    return {
        Role: MockRole,
        default: MockRole,
    };
});

vi.mock('../src/utils/password', () => {
    return {
        hashPassword: vi.fn().mockResolvedValue('hashed_password'),
        comparePassword: vi.fn().mockResolvedValue(true),
    };
});

// Set environment variables for JWT token generation
process.env.JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
process.env.MONGODB_URI = 'mongodb://localhost:27017/worksphere_test';

describe('Authentication & Health API tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /health', () => {
        it('should return 200 with api status details', async () => {
            const res = await request(app).get('/health');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: true,
                message: 'WorkSphere API is running',
                environment: 'test',
            });
        });
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const mockQueryFindOne = { populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(null).then(resolve); } };
            (User.findOne as any).mockReturnValue(mockQueryFindOne);

            (Role.findOne as any).mockResolvedValue({ _id: 'role_123', name: 'User' });

            const mockQueryFindById = { populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve({
                    _id: 'user_123',
                    name: 'New User',
                    email: 'newuser@example.com',
                    isActive: true,
                    role: {
                        _id: 'role_123',
                        name: 'User',
                        permissions: [],
                    },
                }).then(resolve); } };
            (User.findById as any).mockReturnValue(mockQueryFindById);

            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'New User',
                    email: 'newuser@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.email).toBe('newuser@example.com');
        });

        it('should fail registration if email is already taken', async () => {
            const mockQueryFindOne = { populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve({ _id: 'existing_user' }).then(resolve); } };
            (User.findOne as any).mockReturnValue(mockQueryFindOne);

            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'Existing User',
                    email: 'taken@example.com',
                    password: 'password123',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('is already registered');
        });

        it('should fail validation with invalid payload', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: '',
                    email: 'invalid-email',
                    password: 'short',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('Validation Error');
        });
    });

    describe('POST /api/auth/login', () => {
        it('should login successfully for valid credentials', async () => {
            const mockUser = {
                _id: 'user_123',
                name: 'Test User',
                email: 'test@example.com',
                password: 'hashed_password',
                isActive: true,
                role: {
                    _id: 'role_123',
                    name: 'User',
                    permissions: [],
                },
            };

            const mockQueryFindOne = { populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(mockUser).then(resolve); } };
            (User.findOne as any).mockReturnValue(mockQueryFindOne);

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'correctpassword',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.accessToken).toBeDefined();
            expect(res.body.data.refreshToken).toBeDefined();
        });

        it('should fail login if user is inactive', async () => {
            const mockUser = {
                _id: 'user_123',
                name: 'Inactive User',
                email: 'inactive@example.com',
                password: 'hashed_password',
                isActive: false,
                role: {
                    _id: 'role_123',
                    name: 'User',
                },
            };

            const mockQueryFindOne = { populate: vi.fn().mockReturnThis(), then: function(resolve: any) { return Promise.resolve(mockUser).then(resolve); } };
            (User.findOne as any).mockReturnValue(mockQueryFindOne);

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'inactive@example.com',
                    password: 'anypassword',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('deactivated');
        });
    });
});

