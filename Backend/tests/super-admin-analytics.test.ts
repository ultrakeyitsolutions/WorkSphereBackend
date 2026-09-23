import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { generateAccessToken } from '../src/utils/tokens';
import { User } from '../src/modules/users/user.model';
import { Company } from '../src/modules/super-admin/companies/company.model';
import { Project } from '../src/modules/companyadmin/projects/project.model';
import { Task } from '../src/modules/tasks/task.model';
import { Attendance } from '../src/modules/attendance/attendance.model';
import { AuthSession } from '../src/modules/auth/session/auth-session.model';
import { FileModel } from '../src/modules/files/file.model';
import { Message } from '../src/modules/chat/message.model';
import { Call } from '../src/modules/calls/call.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/users/user.model', () => ({
    User: {
        countDocuments: vi.fn(),
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/companies/company.model', () => ({
    Company: {
        countDocuments: vi.fn(),
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/companyadmin/projects/project.model', () => ({
    Project: {
        countDocuments: vi.fn(),
        aggregate: vi.fn(),
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
    },
    AttendanceStatus: {
        CHECKED_IN: 'CHECKED_IN',
        CHECKED_OUT: 'CHECKED_OUT',
    },
}));

vi.mock('../src/modules/auth/session/auth-session.model', () => ({
    AuthSession: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/files/file.model', () => ({
    FileModel: {
        aggregate: vi.fn(),
    },
}));

vi.mock('../src/modules/chat/message.model', () => ({
    Message: {
        countDocuments: vi.fn(),
    },
}));

vi.mock('../src/modules/calls/call.model', () => ({
    Call: {
        countDocuments: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Analytics API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/analytics/users/growth - returns user growth time series', async () => {
        vi.mocked(User.countDocuments).mockResolvedValue(100 as any);
        vi.mocked(User.aggregate).mockResolvedValue([
            { _id: '2026-09-01', count: 10 },
            { _id: '2026-09-02', count: 15 },
        ] as any);

        const res = await request(app)
            .get('/api/superadmin/analytics/users/growth?range=30d')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.range).toBe('30d');
        expect(res.body.data.total).toBe(100);
        expect(res.body.data.points).toHaveLength(2);
        expect(res.body.data.points[0]).toEqual({ date: '2026-09-01', count: 10 });
    });

    it('GET /api/superadmin/analytics/companies/growth - returns company growth time series', async () => {
        vi.mocked(Company.countDocuments).mockResolvedValue(25 as any);
        vi.mocked(Company.aggregate).mockResolvedValue([
            { _id: '2026-09-01', count: 2 },
            { _id: '2026-09-02', count: 3 },
        ] as any);

        const res = await request(app)
            .get('/api/superadmin/analytics/companies/growth?range=7d')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.range).toBe('7d');
        expect(res.body.data.points).toHaveLength(2);
    });

    it('GET /api/superadmin/analytics/projects/summary - returns project distributions', async () => {
        vi.mocked(Project.countDocuments).mockResolvedValue(40 as any);
        vi.mocked(Project.aggregate)
            .mockResolvedValueOnce([{ _id: 'ACTIVE', count: 30 }, { _id: 'COMPLETED', count: 10 }] as any)
            .mockResolvedValueOnce([{ _id: 'HIGH', count: 25 }, { _id: 'MEDIUM', count: 15 }] as any)
            .mockResolvedValueOnce([{ _id: 'INTERNAL', count: 20 }, { _id: 'CLIENT', count: 20 }] as any);

        const res = await request(app)
            .get('/api/superadmin/analytics/projects/summary')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.total).toBe(40);
        expect(res.body.data.byStatus.ACTIVE).toBe(30);
        expect(res.body.data.byPriority.HIGH).toBe(25);
    });

    it('GET /api/superadmin/analytics/workforce - returns workforce distribution and attendance rates', async () => {
        vi.mocked(User.countDocuments)
            .mockResolvedValueOnce(100 as any) // total
            .mockResolvedValueOnce(90 as any)  // active
            .mockResolvedValueOnce(10 as any); // inactive
        vi.mocked(Attendance.countDocuments).mockResolvedValue(45 as any);
        vi.mocked(Task.countDocuments)
            .mockResolvedValueOnce(200 as any) // totalTasks
            .mockResolvedValueOnce(150 as any); // completedTasks

        const res = await request(app)
            .get('/api/superadmin/analytics/workforce')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalUsers).toBe(100);
        expect(res.body.data.activeUsers).toBe(90);
        expect(res.body.data.attendanceRate).toBe(45); // 45 / 100 * 100
        expect(res.body.data.taskCompletionRate).toBe(75); // 150 / 200 * 100
    });

    it('GET /api/superadmin/analytics/platform-usage - returns storage and communication usage', async () => {
        vi.mocked(AuthSession.countDocuments).mockResolvedValue(120 as any);
        vi.mocked(FileModel.aggregate).mockResolvedValue([
            { _id: null, totalFiles: 500, totalBytes: 104857600 },
        ] as any);
        vi.mocked(Message.countDocuments).mockResolvedValue(3200 as any);
        vi.mocked(Call.countDocuments).mockResolvedValue(85 as any);

        const res = await request(app)
            .get('/api/superadmin/analytics/platform-usage')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.activeSessions).toBe(120);
        expect(res.body.data.totalFiles).toBe(500);
        expect(res.body.data.totalStorageBytes).toBe(104857600);
        expect(res.body.data.totalMessages).toBe(3200);
        expect(res.body.data.totalCalls).toBe(85);
    });
});
