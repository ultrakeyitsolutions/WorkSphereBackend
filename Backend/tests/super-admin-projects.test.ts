import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { Project, ProjectTeamMember, ProjectInCharge } from '../src/modules/companyadmin/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { TaskBug } from '../src/modules/task-bugs/task-bug.model';
import { TimeTracking } from '../src/modules/task-tracking/time-tracking.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
    ProjectTeamMember: {
        find: vi.fn(),
        aggregate: vi.fn(),
        countDocuments: vi.fn(),
    },
    ProjectInCharge: {
        find: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        find: vi.fn(),
        countDocuments: vi.fn(),
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/task-bugs/task-bug.model', () => ({
    TaskBug: {
        countDocuments: vi.fn(),
    },
    BugStatus: {
        OPEN: 'OPEN',
        IN_PROGRESS: 'IN_PROGRESS',
        RESOLVED: 'RESOLVED',
        CLOSED: 'CLOSED',
    },
}));

vi.mock('../src/modules/task-tracking/time-tracking.model', () => ({
    TimeTracking: {
        aggregate: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Projects API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const validProjectId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/projects - returns global list of projects with task and member counts', async () => {
        const mockProject = {
            _id: new Types.ObjectId(validProjectId),
            name: 'Platform Core Overhaul',
            description: 'Refactoring modular core',
            type: 'DEVELOPMENT',
            priority: 'HIGH',
            status: 'ACTIVE',
            companyId: { _id: 'comp_1', name: 'Acme Corp', slug: 'acme-corp' },
            createdById: { _id: 'user_1', name: 'Bob Admin', email: 'bob@acme.com' },
            startDate: new Date(),
            endDate: new Date(),
            isArchived: false,
            isPinned: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(Project.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        skip: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                lean: vi.fn().mockResolvedValue([mockProject]),
                            }),
                        }),
                    }),
                }),
            }),
        } as any);

        vi.mocked(Project.countDocuments).mockResolvedValue(1 as any);
        vi.mocked(Task.aggregate).mockResolvedValue([
            { _id: new Types.ObjectId(validProjectId), total: 20, completed: 15 },
        ] as any);
        vi.mocked(ProjectTeamMember.aggregate).mockResolvedValue([
            { _id: new Types.ObjectId(validProjectId), count: 6 },
        ] as any);

        const res = await request(app)
            .get('/api/superadmin/projects?page=1&limit=10')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.projects).toHaveLength(1);
        expect(res.body.data.projects[0].name).toBe('Platform Core Overhaul');
        expect(res.body.data.projects[0].progress).toBe(75); // 15 / 20 * 100
        expect(res.body.data.projects[0].memberCount).toBe(6);
        expect(res.body.data.pagination.total).toBe(1);
    });

    it('GET /api/superadmin/projects/:projectId - returns detailed project info', async () => {
        const mockProject = {
            _id: new Types.ObjectId(validProjectId),
            name: 'Platform Core Overhaul',
            description: 'Refactoring modular core',
            type: 'DEVELOPMENT',
            priority: 'HIGH',
            status: 'ACTIVE',
            companyId: { _id: 'comp_1', name: 'Acme Corp', slug: 'acme-corp', domain: 'acme.com' },
            createdById: { _id: 'user_1', name: 'Bob Admin', email: 'bob@acme.com' },
            startDate: new Date(),
            endDate: new Date(),
            actualEndDate: null,
            isArchived: false,
            isPinned: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(Project.findOne).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(mockProject),
                }),
            }),
        } as any);

        vi.mocked(ProjectInCharge.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{ userId: { _id: 'u1', name: 'Incharge Lead', email: 'lead@acme.com' }, addedAt: new Date() }]),
            }),
        } as any);

        vi.mocked(ProjectTeamMember.find).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{ userId: { _id: 'u2', name: 'Dev 1', email: 'dev@acme.com' }, canCreateTasks: true, addedAt: new Date() }]),
            }),
        } as any);

        vi.mocked(Task.aggregate).mockResolvedValue([{ total: 10, completed: 8 }] as any);

        const res = await request(app)
            .get(`/api/superadmin/projects/${validProjectId}`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Platform Core Overhaul');
        expect(res.body.data.progress).toBe(80);
        expect(res.body.data.inCharges).toHaveLength(1);
        expect(res.body.data.members).toHaveLength(1);
    });

    it('GET /api/superadmin/projects/:projectId/statistics - returns project statistics', async () => {
        vi.mocked(Project.findOne).mockResolvedValue({ _id: validProjectId } as any);
        vi.mocked(Task.countDocuments)
            .mockResolvedValueOnce(30 as any) // total
            .mockResolvedValueOnce(20 as any) // completed
            .mockResolvedValueOnce(8 as any)  // inProgress
            .mockResolvedValueOnce(2 as any); // notStarted

        vi.mocked(TaskBug.countDocuments)
            .mockResolvedValueOnce(5 as any) // total
            .mockResolvedValueOnce(2 as any) // open
            .mockResolvedValueOnce(3 as any); // resolved

        vi.mocked(ProjectTeamMember.countDocuments).mockResolvedValue(10 as any);
        vi.mocked(ProjectInCharge.countDocuments).mockResolvedValue(2 as any);
        vi.mocked(TimeTracking.aggregate).mockResolvedValue([{ totalSeconds: 72000 }] as any);

        const res = await request(app)
            .get(`/api/superadmin/projects/${validProjectId}/statistics`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.tasks.total).toBe(30);
        expect(res.body.data.tasks.completed).toBe(20);
        expect(res.body.data.bugs.open).toBe(2);
        expect(res.body.data.team.totalMembers).toBe(10);
        expect(res.body.data.timeTracking.totalWorkedHours).toBe(20);
    });
});
