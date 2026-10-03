import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

const mocks = vi.hoisted(() => ({
    wishlistCreate: vi.fn(),
    wishlistFind: vi.fn(),
    wishlistFindOne: vi.fn(),
    wishlistFindById: vi.fn(),
    wishlistFindOneAndDelete: vi.fn(),
    wishlistCountDocuments: vi.fn(),
    wishlistAggregate: vi.fn(),
    projectFindOne: vi.fn(),
    projectCanAccess: vi.fn(),
    settingsFindOneAndUpdate: vi.fn(),
    taskCreate: vi.fn(),
}));

vi.mock('../src/modules/wishlist/wishlist.model', () => ({
    Wishlist: {
        create: mocks.wishlistCreate,
        find: mocks.wishlistFind,
        findOne: mocks.wishlistFindOne,
        findById: mocks.wishlistFindById,
        findOneAndDelete: mocks.wishlistFindOneAndDelete,
        countDocuments: mocks.wishlistCountDocuments,
        aggregate: mocks.wishlistAggregate,
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        create: mocks.taskCreate,
    },
    TaskPriority: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT' },
    TaskType: { TASK: 'TASK', BUG: 'BUG', STORY: 'STORY' },
    TaskCriticality: { NON_CRITICAL: 'NON_CRITICAL', CRITICAL: 'CRITICAL' },
}));

vi.mock('../src/modules/tasks/status.model', () => ({
    Status: { findOne: vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' }) }) }) },
}));

vi.mock('../src/modules/tasks/stage.model', () => ({
    Stage: { findOne: vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439012' }) }) }) },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: { findOne: mocks.projectFindOne, findById: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ name: 'Test Project' }) }) }) },
    ProjectSettings: { findOneAndUpdate: mocks.settingsFindOneAndUpdate },
}));

vi.mock('../src/modules/companyadmin/projects/project.service', () => ({
    ProjectService: { canAccessProject: mocks.projectCanAccess },
}));

vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: '507f1f77bcf86cd799439013',
            companyId: '507f1f77bcf86cd799439014',
            role: 'COMPANY_ADMIN',
        };
        next();
    },
}));

const PROJECT_ID = '507f1f77bcf86cd799439015';
const WISHLIST_ID = '507f1f77bcf86cd799439016';

describe('Wishlist API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectCanAccess.mockResolvedValue(true);
        mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'Test Project' }) });
    });

    describe(`POST /api/projects/${PROJECT_ID}/wishlist`, () => {
        it('should create a wishlist item -> 201', async () => {
            mocks.wishlistCreate.mockResolvedValue({ _id: WISHLIST_ID, title: 'Dark Mode' });
            mocks.wishlistFindById.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue({ _id: WISHLIST_ID, title: 'Dark Mode', status: 'IDEA' }),
                        }),
                        lean: vi.fn().mockResolvedValue({ _id: WISHLIST_ID, title: 'Dark Mode', status: 'IDEA' }),
                    }),
                }),
            });

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/wishlist`)
                .send({
                    title: 'Dark Mode Support',
                    description: 'Full dark theme support across web and mobile',
                    priority: 'HIGH',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.title).toBe('Dark Mode');
        });

        it('should fail with 403 if project access is denied', async () => {
            mocks.projectCanAccess.mockResolvedValue(false);

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/wishlist`)
                .send({ title: 'Unauthorized Idea' });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('should fail validation with 422 if title is missing', async () => {
            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/wishlist`)
                .send({ description: 'No title provided' });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
        });
    });

    describe(`GET /api/projects/${PROJECT_ID}/wishlist`, () => {
        it('should list paginated wishlist items -> 200', async () => {
            const mockItems = [{ _id: WISHLIST_ID, title: 'Export to Excel', status: 'IDEA' }];
            mocks.wishlistFind.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            sort: vi.fn().mockReturnValue({
                                skip: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        lean: vi.fn().mockResolvedValue(mockItems),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            });
            mocks.wishlistCountDocuments.mockResolvedValue(1);

            const res = await request(app).get(`/api/projects/${PROJECT_ID}/wishlist?page=1&limit=20`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.total).toBe(1);
        });
    });

    describe(`GET /api/projects/${PROJECT_ID}/wishlist/summary`, () => {
        it('should return wishlist summary aggregation -> 200', async () => {
            mocks.wishlistAggregate.mockResolvedValue([
                { _id: 'IDEA', count: 5 },
                { _id: 'APPROVED', count: 2 },
                { _id: 'CONVERTED', count: 3 },
            ]);

            const res = await request(app).get(`/api/projects/${PROJECT_ID}/wishlist/summary`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.total).toBe(10);
            expect(res.body.data.ideas).toBe(5);
            expect(res.body.data.approved).toBe(2);
            expect(res.body.data.converted).toBe(3);
        });
    });
});
