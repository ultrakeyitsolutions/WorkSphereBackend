import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { User } from '../src/modules/users/user.model';
import { Project, ProjectTeamMember } from '../src/modules/companyadmin/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { TimeTracking } from '../src/modules/task-tracking/time-tracking.model';
import { AuditLog } from '../src/modules/audit-logs/audit-log.model';
import { AuthSession } from '../src/modules/auth/session/auth-session.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        find: vi.fn(),
        findById: vi.fn(),
        findOne: vi.fn(),
        countDocuments: vi.fn(),
    },
    default: {
        find: vi.fn(),
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        countDocuments: vi.fn(),
    },
    ProjectTeamMember: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/tasks/task.model', () => ({
    Task: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/attendance/attendance.model', () => ({
    Attendance: {
        countDocuments: vi.fn(),
        findOne: vi.fn(),
    },
    AttendanceStatus: {
        CHECKED_IN: 'CHECKED_IN',
        CHECKED_OUT: 'CHECKED_OUT',
    },
}));

vi.mock('../src/modules/task-tracking/time-tracking.model', () => ({
    TimeTracking: {
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        find: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/auth/session/auth-session.model', () => ({
    AuthSession: {
        findOne: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Users API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const validUserId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/users - returns paginated list of users', async () => {
        const mockUser = {
            _id: new Types.ObjectId(validUserId),
            name: 'Alice Smith',
            email: 'alice@example.com',
            role: { name: 'DEVELOPER' },
            companyId: { _id: 'comp_1', name: 'Acme Corp', slug: 'acme-corp', status: 'ACTIVE' },
            status: 'ACTIVE',
            isActive: true,
            mfaEnabled: true,
            mustChangePassword: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(User.find).mockReturnValue({
            select: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        sort: vi.fn().mockReturnValue({
                            skip: vi.fn().mockReturnValue({
                                limit: vi.fn().mockReturnValue({
                                    lean: vi.fn().mockResolvedValue([mockUser]),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        } as any);

        vi.mocked(User.countDocuments).mockResolvedValue(1 as any);

        const res = await request(app)
            .get('/api/superadmin/users?page=1&limit=25')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.users).toHaveLength(1);
        expect(res.body.data.users[0].name).toBe('Alice Smith');
        expect(res.body.data.users[0].role).toBe('DEVELOPER');
        expect(res.body.data.pagination.total).toBe(1);
    });

    it('GET /api/superadmin/users/:userId - returns user details safely', async () => {
        const mockUserDetails = {
            _id: new Types.ObjectId(validUserId),
            name: 'Alice Smith',
            email: 'alice@example.com',
            role: { name: 'DEVELOPER' },
            companyId: { _id: 'comp_1', name: 'Acme Corp', slug: 'acme-corp', status: 'ACTIVE' },
            status: 'ACTIVE',
            isActive: true,
            mfaEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(User.findById).mockReturnValue({
            select: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue(mockUserDetails),
                    }),
                }),
            }),
        } as any);

        vi.mocked(AuthSession.findOne).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ lastUsedAt: new Date() }),
            }),
        } as any);

        const res = await request(app)
            .get(`/api/superadmin/users/${validUserId}`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Alice Smith');
        expect(res.body.data.password).toBeUndefined();
    });

    it('GET /api/superadmin/users/:userId/statistics - returns user metrics', async () => {
        vi.mocked(Project.countDocuments).mockResolvedValue(2 as any);
        vi.mocked(ProjectTeamMember.countDocuments).mockResolvedValue(3 as any);
        vi.mocked(Task.countDocuments).mockResolvedValueOnce(10 as any).mockResolvedValueOnce(7 as any).mockResolvedValueOnce(2 as any);
        vi.mocked(TimeTracking.aggregate).mockResolvedValue([{ totalSeconds: 14400 }] as any);
        vi.mocked(Attendance.countDocuments).mockResolvedValue(20 as any);
        vi.mocked(Attendance.findOne).mockResolvedValue({ status: 'CHECKED_IN' } as any);

        const res = await request(app)
            .get(`/api/superadmin/users/${validUserId}/statistics`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.projects.total).toBe(5);
        expect(res.body.data.tasks.total).toBe(10);
        expect(res.body.data.tasks.completed).toBe(7);
        expect(res.body.data.timesheet.totalWorkedHours).toBe(4);
        expect(res.body.data.attendance.checkedIn).toBe(true);
    });

    it('GET /api/superadmin/users/:userId/permissions - computes effective permissions', async () => {
        const mockUserWithPerms = {
            _id: new Types.ObjectId(validUserId),
            name: 'Alice',
            role: {
                name: 'DEVELOPER',
                permissions: [{ name: 'PROJECT_READ' }, { name: 'TASK_CREATE' }],
            },
            grantedPermissions: [{ name: 'FILE_UPLOAD' }],
            revokedPermissions: [{ name: 'TASK_CREATE' }],
        };

        vi.mocked(User.findById).mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue(mockUserWithPerms),
                    }),
                }),
            }),
        } as any);

        const res = await request(app)
            .get(`/api/superadmin/users/${validUserId}/permissions`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.roleName).toBe('DEVELOPER');
        expect(res.body.data.effectivePermissions).toContain('PROJECT_READ');
        expect(res.body.data.effectivePermissions).toContain('FILE_UPLOAD');
        expect(res.body.data.effectivePermissions).not.toContain('TASK_CREATE');
    });
});
