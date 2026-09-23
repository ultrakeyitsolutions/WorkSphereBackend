import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { generateAccessToken } from '../src/utils/tokens';
import superAdminRouter from '../src/modules/super-admin';

const app = express();
app.use(express.json());
app.use('/api/superadmin', superAdminRouter);

describe('Super Admin System Health API', () => {
    const superAdminToken = generateAccessToken({
        userId: 'admin_123',
        email: 'admin@worksphere.io',
        role: 'SUPER_ADMIN',
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/superadmin/system-health - returns healthy system status', async () => {
        vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1); // connected
        (mongoose.connection as any).db = {
            admin: () => ({
                ping: vi.fn().mockResolvedValue({ ok: 1 }),
            }),
        };

        const res = await request(app)
            .get('/api/superadmin/system-health')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('HEALTHY');
        expect(res.body.data.services.database.status).toBe('HEALTHY');
        expect(res.body.data.services.api.status).toBe('HEALTHY');
    });

    it('GET /api/superadmin/system-health/metrics - returns process memory and db latency metrics', async () => {
        vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
        (mongoose.connection as any).db = {
            admin: () => ({
                ping: vi.fn().mockResolvedValue({ ok: 1 }),
            }),
        };

        const res = await request(app)
            .get('/api/superadmin/system-health/metrics')
            .set('Authorization', `Bearer ${superAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.process).toBeDefined();
        expect(res.body.data.process.memory.heapUsedMb).toBeGreaterThan(0);
        expect(res.body.data.database.status).toBe('connected');
    });
});
