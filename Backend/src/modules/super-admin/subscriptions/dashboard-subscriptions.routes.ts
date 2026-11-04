import { Router } from 'express';
import { DashboardSubscriptionsController } from './dashboard-subscriptions.controller';
import { SubscriptionController } from './subscription.controller';
import { validateRequest } from '../../../middleware/validateRequest';
import { changePlanSchema, complimentarySubscriptionSchema } from './subscription.schema';
import { requireSuperAdmin } from '../shared/super-admin-guard';

const router = Router();

// Enforce authentication & SUPER_ADMIN authorization on all subscription routes
router.use(requireSuperAdmin);

// GET /api/superadmin/subscriptions/summary
router.get('/summary', DashboardSubscriptionsController.getSummary);

// GET /api/superadmin/subscriptions/company/:companyId
router.get('/company/:companyId', DashboardSubscriptionsController.getCompanySubscription);

// POST /api/superadmin/subscriptions/company/:companyId/complimentary
router.post(
    '/company/:companyId/complimentary',
    validateRequest(complimentarySubscriptionSchema),
    SubscriptionController.grantComplimentaryPlan
);

// POST /api/superadmin/subscriptions/company/:companyId/change-plan
router.post(
    '/company/:companyId/change-plan',
    validateRequest(changePlanSchema),
    SubscriptionController.upgradePlan
);

// GET /api/superadmin/subscriptions
router.get('/', DashboardSubscriptionsController.listSubscriptions);

export default router;
