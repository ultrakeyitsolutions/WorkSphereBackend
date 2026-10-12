import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { authorizeRoles } from '../../../middleware/authorization.middleware';
import { validateRequest } from '../../../middleware/validateRequest';
import { CompanyDashboardController } from '../controllers/company-dashboard.controller';
import { MemberDashboardController } from '../controllers/member-dashboard.controller';
import {
    companyOverviewQuerySchema,
    deliveryTrendsQuerySchema,
    projectHealthQuerySchema,
    workloadQuerySchema,
    attentionQuerySchema,
    milestonesQuerySchema,
} from '../validators/dashboard-analytics.validator';

const router = Router();

// Authentication and Company Admin authorization guard
router.use(authenticate);
router.use(authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN'));

/**
 * @route   GET /api/v1/company/dashboard/overview
 * @desc    Company overview KPI metrics, delivery rate, task progress, and period comparisons
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/overview',
    validateRequest(companyOverviewQuerySchema),
    CompanyDashboardController.getOverview
);

import { requireFeature } from '../../../middleware/entitlement.middleware';

/**
 * @route   GET /api/v1/company/dashboard/delivery-trends
 * @desc    Time-bucketed delivery trends (planned vs completed, completion rate)
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/delivery-trends',
    requireFeature('DASHBOARD_ANALYTICS'),
    validateRequest(deliveryTrendsQuerySchema),
    CompanyDashboardController.getDeliveryTrends
);

/**
 * @route   GET /api/v1/company/dashboard/project-health
 * @desc    Project health breakdown (on track, at risk, delayed) with explainable reasons
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/project-health',
    requireFeature('DASHBOARD_ANALYTICS'),
    validateRequest(projectHealthQuerySchema),
    CompanyDashboardController.getProjectHealth
);

/**
 * @route   GET /api/v1/company/dashboard/workload
 * @desc    Aggregated team workload distribution (assigned, open, overdue, workload category)
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/workload',
    requireFeature('DASHBOARD_ANALYTICS'),
    validateRequest(workloadQuerySchema),
    CompanyDashboardController.getWorkload
);

/**
 * @route   GET /api/v1/company/dashboard/attention
 * @desc    Actionable attention items (overdue tasks, upcoming deadlines, at-risk projects, pending leaves & timesheets)
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/attention',
    requireFeature('DASHBOARD_ANALYTICS'),
    validateRequest(attentionQuerySchema),
    CompanyDashboardController.getAttention
);

/**
 * @route   GET /api/v1/company/dashboard/milestones
 * @desc    Recent and upcoming milestones with progress and days remaining
 * @access  Private (Company Admin, Admin, Super Admin)
 */
router.get(
    '/milestones',
    requireFeature('DASHBOARD_ANALYTICS'),
    validateRequest(milestonesQuerySchema),
    CompanyDashboardController.getMilestones
);

/**
 * @route   GET /api/v1/company/dashboard/stats
 * @desc    Legacy stats endpoint for backward compatibility
 * @access  Private (Company Admin)
 */
router.get('/stats', MemberDashboardController.getStats);

export default router;
