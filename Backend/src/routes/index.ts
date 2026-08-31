import { Router, Request, Response } from 'express';
import authRoutes from '../modules/auth/auth.routes';
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

// Modules
router.use('/auth', authRoutes);

export default router;
