import { Router, Request, Response } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import superAdminRoutes from '../modules/super-admin/super-admin.routes';
import { env } from '../config/env';

const router = Router();

// Health endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: 'WorkSphere API is running',
        environment: env.NODE_ENV,
    });
});

// ── Public Modules ────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);

// ── Protected Modules ─────────────────────────────────────────────────────────
router.use('/super-admin', superAdminRoutes);

export default router;
