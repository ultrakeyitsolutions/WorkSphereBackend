import { Router } from 'express';
import { getAllPermissions } from './permission.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// GET /api/v1/permissions
router.get('/', authenticate, getAllPermissions);

export default router;
