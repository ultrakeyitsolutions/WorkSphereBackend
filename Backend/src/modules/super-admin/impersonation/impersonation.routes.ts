import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { ImpersonationController } from './impersonation.controller';

const router = Router();

// All impersonation management endpoints require standard authentication
router.use(authenticate);

// ── POST /api/superadmin/impersonation/start ──────────────────────────────────
router.post('/start', ImpersonationController.start);
router.post('/start/:userId', ImpersonationController.start);

// ── POST /api/superadmin/impersonation/stop ───────────────────────────────────
router.post('/stop', ImpersonationController.stop);

// ── GET /api/superadmin/impersonation/current ──────────────────────────────────
router.get('/current', ImpersonationController.current);

export default router;
