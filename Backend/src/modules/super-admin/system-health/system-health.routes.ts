import { Router } from 'express';
import { SuperAdminSystemHealthController } from './system-health.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all health routes
router.use(requireSuperAdmin);

// GET /api/superadmin/system-health
router.get('/', SuperAdminSystemHealthController.getHealth);

// GET /api/superadmin/system-health/status
router.get('/status', SuperAdminSystemHealthController.getHealth);

// GET /api/superadmin/system-health/metrics
router.get('/metrics', SuperAdminSystemHealthController.getMetrics);

export default router;
