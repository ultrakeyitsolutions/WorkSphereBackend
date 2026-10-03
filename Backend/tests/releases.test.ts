import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

const mocks = vi.hoisted(() => ({
    releaseCreate: vi.fn(),
    releaseFind: vi.fn(),
    releaseFindOne: vi.fn(),
    releaseFindById: vi.fn(),
    releaseFindOneAndDelete: vi.fn(),
    releaseCountDocuments: vi.fn(),
    taskAggregate: vi.fn(),
    taskFind: vi.fn(),
    taskCountDocuments: vi.fn(),
    taskUpdateMany: vi.fn(),
    projectFindOne: vi.fn(),
    projectCanAccess: vi.fn(),
}));

vi.mock('../src/modules/releases/release.model', () => ({
    Release: {
        create: mocks.releaseCreate,
        find: mocks.releaseFind,
        findOne: mocks.releaseFindOne,
        findById: mocks.releaseFindById,
        findOneAndDelete: mocks.releaseFindOneAndDelete,
        countDocuments: mocks.releaseCountDocuments,
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        aggregate: mocks.taskAggregate,
        find: mocks.taskFind,
        countDocuments: mocks.taskCountDocuments,
        updateMany: mocks.taskUpdateMany,
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: { findOne: mocks.projectFindOne },
}));

vi.mock('../src/modules/companyadmin/projects/project.service', () => ({
    ProjectService: { canAccessProject: mocks.projectCanAccess },
}));

vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: '507f1f77bcf86cd799439031',
            companyId: '507f1f77bcf86cd799439032',
            role: 'COMPANY_ADMIN',
        };
        next();
    },
}));

const PROJECT_ID = '507f1f77bcf86cd799439033';
const RELEASE_ID = '507f1f77bcf86cd799439034';

describe('Release API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectCanAccess.mockResolvedValue(true);
        mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'WorkSphere App' }) });
    });

    describe(`POST /api/projects/${PROJECT_ID}/releases`, () => {
        it('should create a release -> 201', async () => {
            mocks.releaseFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
            mocks.releaseCreate.mockResolvedValue({ _id: RELEASE_ID, name: 'Release v1.4.0', version: 'v1.4.0' });
            mocks.releaseFindById.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue({
                                _id: RELEASE_ID,
                                name: 'Release v1.4.0',
                                version: 'v1.4.0',
                                targetDate: new Date('2026-10-30'),
                                status: 'PLANNED',
                            }),
                        }),
                    }),
                }),
            });

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/releases`)
                .send({
                    name: 'Release v1.4.0',
                    version: 'v1.4.0',
                    targetDate: '2026-10-30T00:00:00.000Z',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.version).toBe('v1.4.0');
        });

        it('should reject duplicate version in the same project with 409', async () => {
            mocks.releaseFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({ _id: 'existing_release', version: 'v1.4.0' }),
            });

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/releases`)
                .send({
                    name: 'Duplicate Release',
                    version: 'v1.4.0',
                    targetDate: '2026-10-30T00:00:00.000Z',
                });

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('already exists');
        });
    });

    describe(`POST /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/release`, () => {
        it('should mark release as RELEASED -> 200', async () => {
            const mockReleaseDoc: any = {
                _id: RELEASE_ID,
                name: 'Release v1.4.0',
                version: 'v1.4.0',
                status: 'IN_PROGRESS',
                save: vi.fn().mockResolvedValue(true),
            };
            mocks.releaseFindOne.mockResolvedValue(mockReleaseDoc);

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/release`)
                .send({
                    releaseNotes: 'Fixed minor bugs and improved performance.',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockReleaseDoc.status).toBe('RELEASED');
            expect(mockReleaseDoc.releasedAt).toBeDefined();
        });
    });

    describe(`GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/summary`, () => {
        it('should return release dashboard summary -> 200', async () => {
            mocks.releaseFindOne.mockReturnValue({
                lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'Release v1.4.0', sprintIds: ['s1', 's2'] }),
            });
            mocks.taskAggregate.mockResolvedValue([
                {
                    totalTasks: 20,
                    completedTasks: 15,
                    inProgressTasks: 3,
                    todoTasks: 2,
                    overdueTasks: 0,
                },
            ]);

            const res = await request(app).get(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/summary`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.totalTasks).toBe(20);
            expect(res.body.data.completedTasks).toBe(15);
            expect(res.body.data.completionPercentage).toBe(75);
            expect(res.body.data.sprintCount).toBe(2);
        });
    });
});
