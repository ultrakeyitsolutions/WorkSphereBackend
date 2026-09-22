import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { dashboardQuerySchema } from './dashboard.validator';
import { getDashboard } from './dashboard.controller';

const router = Router();

// Authentication guard
router.use(authenticate);

/**
 * @route   GET /api/dashboard or /api/company-admin/dashboard
 * @desc    Get role-aware & scope-aware dashboard analytics
 * @access  Private (All authenticated users: Super Admin, Company Admin, Manager, Employee)
 */
router.get(
    '/',
    validateRequest(dashboardQuerySchema),
    getDashboard
);

router.get(
    '/dashboard',
    validateRequest(dashboardQuerySchema),
    getDashboard
);

export default router;
