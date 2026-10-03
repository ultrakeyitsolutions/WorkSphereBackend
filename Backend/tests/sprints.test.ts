import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

const mocks = vi.hoisted(() => ({
    sprintCreate: vi.fn(),
    sprintFind: vi.fn(),
    sprintFindOne: vi.fn(),
    sprintFindById: vi.fn(),
    sprintFindOneAndDelete: vi.fn(),
    sprintCountDocuments: vi.fn(),
    taskAggregate: vi.fn(),
    taskFind: vi.fn(),
    taskCountDocuments: vi.fn(),
    taskUpdateMany: vi.fn(),
    projectFindOne: vi.fn(),
    projectCanAccess: vi.fn(),
}));

vi.mock('../src/modules/sprints/sprint.model', () => ({
    Sprint: {
        create: mocks.sprintCreate,
        find: mocks.sprintFind,
        findOne: mocks.sprintFindOne,
        findById: mocks.sprintFindById,
        findOneAndDelete: mocks.sprintFindOneAndDelete,
        countDocuments: mocks.sprintCountDocuments,
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
            userId: '507f1f77bcf86cd799439021',
            companyId: '507f1f77bcf86cd799439022',
            role: 'COMPANY_ADMIN',
        };
        next();
    },
}));

const PROJECT_ID = '507f1f77bcf86cd799439023';
const SPRINT_ID = '507f1f77bcf86cd799439024';

describe('Sprint API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectCanAccess.mockResolvedValue(true);
        mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'Core Engine' }) });
    });

    describe(`POST /api/projects/${PROJECT_ID}/sprints`, () => {
        it('should create a sprint -> 201', async () => {
            mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
            mocks.sprintCreate.mockResolvedValue({ _id: SPRINT_ID, name: 'Sprint 12' });
            mocks.sprintFindById.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            _id: SPRINT_ID,
                            name: 'Sprint 12',
                            startDate: new Date('2026-10-05'),
                            endDate: new Date('2026-10-16'),
                            status: 'PLANNED',
                        }),
                    }),
                }),
            });

            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/sprints`)
                .send({
                    name: 'Sprint 12',
                    goal: 'Complete Notification System',
                    startDate: '2026-10-05T00:00:00.000Z',
                    endDate: '2026-10-16T00:00:00.000Z',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Sprint 12');
            expect(res.body.data.progress).toBe(0);
        });

        it('should fail validation with 422 if startDate >= endDate', async () => {
            const res = await request(app)
                .post(`/api/projects/${PROJECT_ID}/sprints`)
                .send({
                    name: 'Invalid Date Sprint',
                    startDate: '2026-10-20T00:00:00.000Z',
                    endDate: '2026-10-10T00:00:00.000Z',
                });

            expect(res.status).toBe(422);
            expect(res.body.success).toBe(false);
        });
    });

    describe(`POST /api/projects/${PROJECT_ID}/sprints/${SPRINT_ID}/start`, () => {
        it('should start a sprint and set status to ACTIVE -> 200', async () => {
            const mockSprintDoc: any = {
                _id: SPRINT_ID,
                name: 'Sprint 12',
                status: 'PLANNED',
                save: vi.fn().mockResolvedValue(true),
            };
            mocks.sprintFindOne
                .mockResolvedValueOnce(mockSprintDoc) // find current sprint
                .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) }); // check existing active

            const res = await request(app).post(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID}/start`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSprintDoc.status).toBe('ACTIVE');
            expect(mockSprintDoc.save).toHaveBeenCalled();
        });

        it('should reject starting sprint with 409 if another sprint is already ACTIVE', async () => {
            const mockSprintDoc: any = {
                _id: SPRINT_ID,
                name: 'Sprint 12',
                status: 'PLANNED',
                save: vi.fn().mockResolvedValue(true),
            };
            mocks.sprintFindOne
                .mockResolvedValueOnce(mockSprintDoc)
                .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ _id: 'other_sprint', name: 'Sprint 11' }) });

            const res = await request(app).post(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID}/start`);

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('already has an active sprint');
        });
    });

    describe(`GET /api/projects/${PROJECT_ID}/sprints/${SPRINT_ID}/summary`, () => {
        it('should return computed sprint task summary -> 200', async () => {
            mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID, name: 'Sprint 12' }) });
            mocks.taskAggregate.mockResolvedValue([
                {
                    totalTasks: 10,
                    completedTasks: 8,
                    inProgressTasks: 1,
                    todoTasks: 1,
                    overdueTasks: 0,
                    totalEstimatedHours: 40,
                    actualHours: 35,
                },
            ]);

            const res = await request(app).get(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID}/summary`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.totalTasks).toBe(10);
            expect(res.body.data.completedTasks).toBe(8);
            expect(res.body.data.completionPercentage).toBe(80);
        });
    });
});
