import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
    sprintCreate: vi.fn(),
    sprintFind: vi.fn(),
    sprintFindOne: vi.fn(),
    sprintFindById: vi.fn(),
    sprintFindOneAndDelete: vi.fn(),
    sprintCountDocuments: vi.fn(),
    releaseCreate: vi.fn(),
    releaseFind: vi.fn(),
    releaseFindOne: vi.fn(),
    releaseFindById: vi.fn(),
    releaseFindOneAndDelete: vi.fn(),
    releaseCountDocuments: vi.fn(),
    taskAggregate: vi.fn(),
    taskFind: vi.fn(),
    taskFindOne: vi.fn(),
    taskFindById: vi.fn(),
    taskCreate: vi.fn(),
    taskCountDocuments: vi.fn(),
    taskUpdateMany: vi.fn(),
    projectFindOne: vi.fn(),
    projectFindById: vi.fn(),
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
        findOne: mocks.taskFindOne,
        findById: mocks.taskFindById,
        create: mocks.taskCreate,
        countDocuments: mocks.taskCountDocuments,
        updateMany: mocks.taskUpdateMany,
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        findOne: mocks.projectFindOne,
        findById: mocks.projectFindById,
    },
    ProjectSettings: { findOne: vi.fn().mockResolvedValue({ lastTaskItemNumber: 10 }) },
    ProjectTeamMember: { find: vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) },
    ProjectInCharge: { find: vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) },
}));

vi.mock('../src/modules/companyadmin/projects/project.service', () => ({
    ProjectService: { canAccessProject: mocks.projectCanAccess },
}));

vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: '507f1f77bcf86cd799439001',
            companyId: '507f1f77bcf86cd799439002',
            role: 'COMPANY_ADMIN',
        };
        next();
    },
}));

const PROJECT_ID = '507f1f77bcf86cd799439010';
const SPRINT_ID_1 = '507f1f77bcf86cd799439020';
const SPRINT_ID_2 = '507f1f77bcf86cd799439021';
const RELEASE_ID = '507f1f77bcf86cd799439030';
const TASK_ID = '507f1f77bcf86cd799439040';

describe('Sprint Task Workflow & Release Integration (20 E2E Verification Points)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectCanAccess.mockResolvedValue(true);
        mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'WorkSphere Suite' }) });
        mocks.projectFindById.mockReturnValue({
            select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'WorkSphere Suite' }) }),
        });
    });

    // 1. Get sprint tasks
    it('1. should retrieve paginated tasks for a specific sprint', async () => {
        mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID_1, name: 'Sprint 1' }) });
        mocks.taskFind.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    sort: vi.fn().mockReturnValue({
                                        skip: vi.fn().mockReturnValue({
                                            limit: vi.fn().mockReturnValue({
                                                lean: vi.fn().mockResolvedValue([
                                                    { _id: TASK_ID, title: 'Task in Sprint', sprintId: SPRINT_ID_1, progress: 0 },
                                                ]),
                                            }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });
        mocks.taskCountDocuments.mockResolvedValue(1);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].title).toBe('Task in Sprint');
    });

    // 2. Pagination
    it('2. should enforce pagination bounds on sprint task endpoint', async () => {
        mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID_1, name: 'Sprint 1' }) });
        mocks.taskFind.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    sort: vi.fn().mockReturnValue({
                                        skip: vi.fn().mockReturnValue({
                                            limit: vi.fn().mockReturnValue({
                                                lean: vi.fn().mockResolvedValue([]),
                                            }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });
        mocks.taskCountDocuments.mockResolvedValue(55);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks?page=2&limit=25`);
        expect(res.status).toBe(200);
        expect(res.body.pagination.page).toBe(2);
        expect(res.body.pagination.limit).toBe(25);
        expect(res.body.pagination.total).toBe(55);
        expect(res.body.pagination.totalPages).toBe(3);
    });

    // 3. Status filtering
    it('3. should support status filtering (TODO, IN_PROGRESS, ON_HOLD, DONE) via MongoDB query', async () => {
        mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID_1, name: 'Sprint 1' }) });
        mocks.taskFind.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    sort: vi.fn().mockReturnValue({
                                        skip: vi.fn().mockReturnValue({
                                            limit: vi.fn().mockReturnValue({
                                                lean: vi.fn().mockResolvedValue([]),
                                            }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });
        mocks.taskCountDocuments.mockResolvedValue(0);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks?status=DONE`);
        expect(res.status).toBe(200);
        expect(mocks.taskFind).toHaveBeenCalledWith(expect.objectContaining({ progress: 100 }));
    });

    // 4. Drag TODO -> IN_PROGRESS
    it('4. should update status from TODO to IN_PROGRESS and set progress to 50%', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Design API Spec',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_1),
            progress: 0,
            isArchived: false,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, progress: 50 }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'IN_PROGRESS' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockTaskDoc.progress).toBe(50);
        expect(mockTaskDoc.save).toHaveBeenCalled();
    });

    // 5. IN_PROGRESS -> ON_HOLD
    it('5. should update status from IN_PROGRESS to ON_HOLD', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Refactor DB',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_1),
            progress: 50,
            isArchived: false,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue({ ...mockTaskDoc }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'ON_HOLD' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // 6. ON_HOLD -> IN_PROGRESS
    it('6. should transition from ON_HOLD back to IN_PROGRESS', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Refactor DB',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_1),
            progress: 25,
            isArchived: false,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, progress: 25 }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'IN_PROGRESS' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // 7. IN_PROGRESS -> DONE
    it('7. should transition from IN_PROGRESS to DONE and mark progress as 100%', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Refactor DB',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_1),
            progress: 50,
            isArchived: false,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, progress: 100 }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'DONE' });

        expect(res.status).toBe(200);
        expect(mockTaskDoc.progress).toBe(100);
        expect(mockTaskDoc.completedDate).toBeDefined();
    });

    // 8. Invalid task status
    it('8. should reject invalid empty status with 422', async () => {
        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: '' });

        expect(res.status).toBe(422);
    });

    // 9. Task from another sprint
    it('9. should reject status update if task belongs to another sprint with 400', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Mismatched Sprint Task',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_2), // Belongs to Sprint 2
            isArchived: false,
            save: vi.fn(),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'IN_PROGRESS' });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('does not belong to this sprint');
    });

    // 10. Task from another project
    it('10. should return 404 if task does not belong to the target project', async () => {
        mocks.taskFindOne.mockResolvedValue(null); // Not found in this project

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks/${TASK_ID}/status`)
            .send({ status: 'IN_PROGRESS' });

        expect(res.status).toBe(404);
    });

    // 11. Move task between sprints
    it('11. should support moving task to another sprint via PATCH /tasks/:taskId/sprint', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Sprint Migration Task',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: new Types.ObjectId(SPRINT_ID_1),
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID_2, name: 'Sprint 2', status: 'PLANNED' }) });
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    populate: vi.fn().mockReturnValue({
                                        populate: vi.fn().mockReturnValue({
                                            lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, sprintId: SPRINT_ID_2 }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/tasks/${TASK_ID}/sprint`)
            .send({ sprintId: SPRINT_ID_2 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockTaskDoc.sprintId.toString()).toBe(SPRINT_ID_2);
    });

    // 12. Assign task to release
    it('12. should assign task to a release via PATCH /tasks/:taskId/release', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Release Feature Task',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            releaseId: null,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.releaseFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', status: 'PLANNED' }) });
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    populate: vi.fn().mockReturnValue({
                                        populate: vi.fn().mockReturnValue({
                                            lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, releaseId: RELEASE_ID }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/tasks/${TASK_ID}/release`)
            .send({ releaseId: RELEASE_ID });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockTaskDoc.releaseId.toString()).toBe(RELEASE_ID);
    });

    // 13. Remove task from release
    it('13. should support removing task from release by passing null', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Release Task',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            releaseId: new Types.ObjectId(RELEASE_ID),
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    populate: vi.fn().mockReturnValue({
                                        populate: vi.fn().mockReturnValue({
                                            lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, releaseId: null }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/tasks/${TASK_ID}/release`)
            .send({ releaseId: null });

        expect(res.status).toBe(200);
        expect(mockTaskDoc.releaseId).toBeNull();
    });

    // 14. Release progress calculation
    it('14. should calculate release progress dynamically from linked tasks', async () => {
        mocks.releaseFindOne.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', sprintIds: [] }),
                        }),
                    }),
                }),
            }),
            lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', sprintIds: [] }),
        });
        mocks.taskAggregate.mockResolvedValue([
            {
                total: 10,
                done: 7,
                inProgress: 2,
                todo: 1,
                onHold: 0,
                overdueTasks: 0,
            },
        ]);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/summary`);
        expect(res.status).toBe(200);
        expect(res.body.data.completionPercentage).toBe(70);
        expect(res.body.data.isReadyToShip).toBe(false);
    });

    // 15. Release becomes ready to ship
    it('15. should mark release isReadyToShip as true when 100% of tasks are completed', async () => {
        mocks.releaseFindOne.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', sprintIds: [] }),
                        }),
                    }),
                }),
            }),
            lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', sprintIds: [] }),
        });
        mocks.taskAggregate.mockResolvedValue([
            {
                total: 10,
                done: 10,
                inProgress: 0,
                todo: 0,
                onHold: 0,
                overdueTasks: 0,
            },
        ]);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/summary`);
        expect(res.status).toBe(200);
        expect(res.body.data.completionPercentage).toBe(100);
        expect(res.body.data.isReadyToShip).toBe(true);
    });

    // 16. Ship release (200 OK)
    it('16. should ship release successfully when all tasks are complete', async () => {
        const mockReleaseDoc: any = {
            _id: new Types.ObjectId(RELEASE_ID),
            name: 'Release v2.0',
            version: 'v2.0',
            status: 'READY_TO_SHIP',
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.releaseFindOne.mockResolvedValue(mockReleaseDoc);
        mocks.taskAggregate.mockResolvedValue([{ total: 10, done: 10, taskIds: [] }]);
        mocks.releaseFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue({
                                _id: RELEASE_ID,
                                name: 'Release v2.0',
                                version: 'v2.0',
                                status: 'RELEASED',
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .post(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/ship`)
            .send({ releaseNotes: 'Final production release v2.0' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockReleaseDoc.status).toBe('RELEASED');
        expect(mockReleaseDoc.releasedAt).toBeDefined();
    });

    // 17. Cannot ship incomplete release
    it('17. should reject shipping incomplete release with 409 Conflict', async () => {
        const mockReleaseDoc: any = {
            _id: new Types.ObjectId(RELEASE_ID),
            name: 'Release v2.0',
            version: 'v2.0',
            status: 'IN_PROGRESS',
            save: vi.fn(),
        };
        mocks.releaseFindOne.mockResolvedValue(mockReleaseDoc);
        mocks.taskAggregate.mockResolvedValue([{ total: 10, done: 8, taskIds: [] }]); // 2 tasks incomplete

        const res = await request(app)
            .post(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/ship`)
            .send({});

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('incomplete tasks');
    });

    // 18. Cannot ship already released release
    it('18. should reject shipping an already RELEASED release with 409 Conflict', async () => {
        const mockReleaseDoc: any = {
            _id: new Types.ObjectId(RELEASE_ID),
            name: 'Release v2.0',
            version: 'v2.0',
            status: 'RELEASED',
            save: vi.fn(),
        };
        mocks.releaseFindOne.mockResolvedValue(mockReleaseDoc);

        const res = await request(app)
            .post(`/api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/ship`)
            .send({});

        expect(res.status).toBe(409);
        expect(res.body.message).toContain('already been shipped');
    });

    // 19. Planning combined assignment
    it('19. should atomically update both sprintId and releaseId via /planning endpoint', async () => {
        const mockTaskDoc: any = {
            _id: new Types.ObjectId(TASK_ID),
            title: 'Planning Task',
            projectId: new Types.ObjectId(PROJECT_ID),
            companyId: new Types.ObjectId('507f1f77bcf86cd799439002'),
            sprintId: null,
            releaseId: null,
            save: vi.fn().mockResolvedValue(true),
        };
        mocks.taskFindOne.mockResolvedValue(mockTaskDoc);
        mocks.sprintFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SPRINT_ID_1, name: 'Sprint 1', status: 'PLANNED' }) });
        mocks.releaseFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: RELEASE_ID, name: 'v2.0', status: 'PLANNED' }) });
        mocks.taskFindById.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({
                            populate: vi.fn().mockReturnValue({
                                populate: vi.fn().mockReturnValue({
                                    populate: vi.fn().mockReturnValue({
                                        populate: vi.fn().mockReturnValue({
                                            lean: vi.fn().mockResolvedValue({ ...mockTaskDoc, sprintId: SPRINT_ID_1, releaseId: RELEASE_ID }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        });

        const res = await request(app)
            .patch(`/api/projects/${PROJECT_ID}/tasks/${TASK_ID}/planning`)
            .send({ sprintId: SPRINT_ID_1, releaseId: RELEASE_ID });

        expect(res.status).toBe(200);
        expect(mockTaskDoc.sprintId.toString()).toBe(SPRINT_ID_1);
        expect(mockTaskDoc.releaseId.toString()).toBe(RELEASE_ID);
    });

    // 20. Permission & Project Isolation failures
    it('20. should reject access with 403 when user is not a member of the project', async () => {
        mocks.projectCanAccess.mockResolvedValue(false);

        const res = await request(app).get(`/api/projects/${PROJECT_ID}/sprints/${SPRINT_ID_1}/tasks`);
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});
