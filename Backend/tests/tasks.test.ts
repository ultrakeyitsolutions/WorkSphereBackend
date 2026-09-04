import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

// ─── Hoist mocks so they can be used inside vi.mock factories ─────────────────
const mocks = vi.hoisted(() => ({
    projectFindOne: vi.fn(),
    settingsFindOne: vi.fn(),
    settingsFindOneAndUpdate: vi.fn(),
    inChargeExists: vi.fn(),
    inChargeFind: vi.fn(),
    teamMemberExists: vi.fn(),
    teamMemberFindOne: vi.fn(),
    teamMemberFind: vi.fn(),
    taskCreate: vi.fn(),
    taskFindById: vi.fn(),
    entitlementHasFeature: vi.fn(),
    stageFindOne: vi.fn(),
    statusFindOne: vi.fn(),
    userFindById: vi.fn(),
    assignmentCreate: vi.fn()
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        create: mocks.taskCreate,
        findById: mocks.taskFindById
    }
}));

vi.mock('../src/modules/tasks/stage.model', () => ({ Stage: { findOne: mocks.stageFindOne } }));
vi.mock('../src/modules/tasks/status.model', () => ({ Status: { findOne: mocks.statusFindOne } }));
vi.mock('../src/modules/users/user.model', () => ({ User: { findById: mocks.userFindById } }));
vi.mock('../src/modules/tasks/task-assignment.model', () => ({ TaskAssignment: { create: mocks.assignmentCreate } }));

vi.mock('../src/modules/tasks/recurring-rule.model', () => ({
    RecurringRule: {
        create: vi.fn(),
        findOne: vi.fn(),
        updateOne: vi.fn()
    }
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: { findOne: mocks.projectFindOne },
    ProjectSettings: {
        findOne: mocks.settingsFindOne,
        findOneAndUpdate: mocks.settingsFindOneAndUpdate
    },
    ProjectInCharge: {
        exists: mocks.inChargeExists,
        find: mocks.inChargeFind
    },
    ProjectTeamMember: {
        exists: mocks.teamMemberExists,
        findOne: mocks.teamMemberFindOne,
        find: mocks.teamMemberFind
    }
}));

vi.mock('../src/services/entitlement.service', () => ({
    EntitlementService: { hasFeature: mocks.entitlementHasFeature }
}));

vi.mock('../src/middleware/auth.middleware', () => ({
    authenticate: (req: any, _res: any, next: any) => {
        req.user = {
            userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            companyId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            roleLevel: 10
        };
        next();
    }
}));

// ─── Constants ────────────────────────────────────────────────────────────────
const PROJECT_ID = 'cccccccccccccccccccccccc';
const COMPANY_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const mockProject = {
    _id: PROJECT_ID,
    companyId: COMPANY_ID,
    createdById: USER_ID,   // matches userId → owner, so canCreate = true
    isActive: true,
    isArchived: false
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Tasks API', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.stageFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'stage1', name: 'New' }) });
        mocks.statusFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'status1', name: 'New' }) });
        mocks.userFindById.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'user1', name: 'User' }) });
        mocks.assignmentCreate.mockResolvedValue({});

        // Mock populate chain
        const mockPopulateChain = { lean: vi.fn().mockResolvedValue({ _id: 'task_111', title: 'Normal Task', itemNumber: 1 }) };
        mockPopulateChain.populate = vi.fn().mockReturnValue(mockPopulateChain);
        mocks.taskFindById.mockReturnValue(mockPopulateChain);

        // Default safe responses
        mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
        mocks.settingsFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
        mocks.settingsFindOneAndUpdate.mockResolvedValue({ lastTaskItemNumber: 1 });
        mocks.inChargeExists.mockResolvedValue(null);
        mocks.inChargeFind.mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
        mocks.teamMemberExists.mockResolvedValue(null);
        mocks.teamMemberFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
        mocks.teamMemberFind.mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
        mocks.entitlementHasFeature.mockResolvedValue(true);
    });

    describe(`POST /api/v1/company/projects/${PROJECT_ID}/tasks`, () => {

        it('should create a normal task → 201', async () => {
            mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockProject) });
            mocks.settingsFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ allowTeamMembersToCreateTasks: true }) });
            mocks.taskCreate.mockResolvedValue({ _id: 'task_111', title: 'Normal Task', itemNumber: 1 });

            const res = await request(app)
                .post(`/api/v1/company/projects/${PROJECT_ID}/tasks`)
                .send({ title: 'Normal Task', isRecurring: false });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.task.id).toBe('task_111');
        });

        it('should return 404 if project not found', async () => {
            mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

            const res = await request(app)
                .post(`/api/v1/company/projects/${PROJECT_ID}/tasks`)
                .send({ title: 'Test Task', isRecurring: false });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Project not found');
        });

        it('should return 403 with FEATURE_NOT_AVAILABLE when plan disallows recurring → 403', async () => {
            mocks.projectFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockProject) });
            mocks.settingsFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
            mocks.entitlementHasFeature.mockResolvedValue(false);

            const res = await request(app)
                .post(`/api/v1/company/projects/${PROJECT_ID}/tasks`)
                .send({
                    title: 'Recurring Task',
                    isRecurring: true,
                    recurrence: {
                        pattern: 'DAILY',
                        repeatEvery: 1,
                        startDateTime: '2026-09-04T09:00:00.000Z'
                    }
                });

            expect(res.status).toBe(403);
            expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE');
            expect(res.body.action).toBe('UPGRADE_PLAN');
        });
    });
});
