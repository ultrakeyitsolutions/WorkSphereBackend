import { Router } from 'express';
import { DashboardSubscriptionsController } from './dashboard-subscriptions.controller';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all subscription routes
router.use(requireSuperAdmin);

// GET /api/superadmin/subscriptions/summary
router.get('/summary', DashboardSubscriptionsController.getSummary);

// GET /api/superadmin/subscriptions/company/:companyId
router.get('/company/:companyId', DashboardSubscriptionsController.getCompanySubscription);

// GET /api/superadmin/subscriptions
router.get('/', DashboardSubscriptionsController.listSubscriptions);

export default router;
