import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { validateRequest } from '../../../middleware/validateRequest';
import { MemberDashboardController } from '../controllers/member-dashboard.controller';
import {
    memberOverviewQuerySchema,
    memberTrendsQuerySchema,
    memberMyWorkQuerySchema,
} from '../validators/dashboard-analytics.validator';

const router = Router();

// Authentication guard — all authenticated company members
router.use(authenticate);

/**
 * @route   GET /api/v1/member/dashboard/overview
 * @desc    Member overview metrics (assigned tasks, completion rate, tracked hours, today attendance)
 * @access  Private (Authenticated Member - strictly self-scoped)
 */
router.get(
    '/overview',
    validateRequest(memberOverviewQuerySchema),
    MemberDashboardController.getOverview
);

/**
 * @route   GET /api/v1/member/dashboard/work-trends
 * @desc    Personal task completion and work trends (weekly/daily)
 * @access  Private (Authenticated Member - strictly self-scoped)
 */
router.get(
    '/work-trends',
    validateRequest(memberTrendsQuerySchema),
    MemberDashboardController.getWorkTrends
);

/**
 * @route   GET /api/v1/member/dashboard/my-work
 * @desc    Actionable member work items (in progress, overdue, upcoming, my projects)
 * @access  Private (Authenticated Member - strictly self-scoped)
 */
router.get(
    '/my-work',
    validateRequest(memberMyWorkQuerySchema),
    MemberDashboardController.getMyWork
);

/**
 * @route   GET /api/v1/member/dashboard/stats
 * @desc    Legacy stats endpoint for backward compatibility
 * @access  Private (Authenticated Member)
 */
router.get('/stats', MemberDashboardController.getStats);

export default router;
