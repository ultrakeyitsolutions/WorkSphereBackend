import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import { AuditLog } from '../src/modules/audit-logs/audit-log.model';
import superAdminRouter from '../src/modules/super-admin';

vi.mock('../src/modules/audit-logs/audit-log.model', () => ({
    AuditLog: {
        find: vi.fn(),
        findById: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin Audit API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    const validAuditId = new Types.ObjectId().toString();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/audit/logs - returns paginated list of audit records', async () => {
        const mockLog = {
            _id: new Types.ObjectId(validAuditId),
            action: 'COMPANY_CREATED',
            actorId: 'admin_123',
            actorEmail: 'admin@worksphere.io',
            companyName: 'Acme Corp',
            description: 'Company created',
            success: true,
            createdAt: new Date(),
        };

        vi.mocked(AuditLog.find).mockReturnValue({
            sort: vi.fn().mockReturnValue({
                skip: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue([mockLog]),
                    }),
                }),
            }),
        } as any);

        vi.mocked(AuditLog.countDocuments).mockResolvedValue(1 as any);

        const res = await request(app)
            .get('/api/superadmin/audit/logs?page=1&limit=20&action=COMPANY_CREATED')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.logs).toHaveLength(1);
        expect(res.body.data.logs[0].action).toBe('COMPANY_CREATED');
        expect(res.body.data.pagination.total).toBe(1);
    });

    it('GET /api/superadmin/audit/logs/:auditId - returns single audit record with sanitized metadata', async () => {
        const mockLog = {
            _id: new Types.ObjectId(validAuditId),
            action: 'COMPANY_UPDATED',
            actorId: 'admin_123',
            actorEmail: 'admin@worksphere.io',
            description: 'Company details edited',
            metadata: {
                changes: ['name'],
                password: 'sensitive_password_should_be_stripped',
            },
            success: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        vi.mocked(AuditLog.findById).mockReturnValue({
            lean: vi.fn().mockResolvedValue(mockLog),
        } as any);

        const res = await request(app)
            .get(`/api/superadmin/audit/logs/${validAuditId}`)
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.action).toBe('COMPANY_UPDATED');
        expect(res.body.data.metadata.password).toBeUndefined();
        expect(res.body.data.metadata.changes).toEqual(['name']);
    });
});
