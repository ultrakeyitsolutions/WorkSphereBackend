import { Router } from 'express';
import { OverviewController } from './overview.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Apply super admin authentication guard to all overview endpoints
router.use(requireSuperAdmin);

// GET /api/superadmin/overview/summary
router.get('/summary', OverviewController.getSummary);

export default router;
