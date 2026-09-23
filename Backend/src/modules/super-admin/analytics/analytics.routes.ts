import { Router } from 'express';
import { SuperAdminAnalyticsController } from './analytics.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN check on all analytics routes
router.use(requireSuperAdmin);

// GET /api/superadmin/analytics/users/growth
router.get('/users/growth', SuperAdminAnalyticsController.getUserGrowth);

// GET /api/superadmin/analytics/companies/growth
router.get('/companies/growth', SuperAdminAnalyticsController.getCompanyGrowth);

// GET /api/superadmin/analytics/projects/summary
router.get('/projects/summary', SuperAdminAnalyticsController.getProjectsSummary);

// GET /api/superadmin/analytics/workforce
router.get('/workforce', SuperAdminAnalyticsController.getWorkforceAnalytics);

// GET /api/superadmin/analytics/platform-usage
router.get('/platform-usage', SuperAdminAnalyticsController.getPlatformUsage);

export default router;
