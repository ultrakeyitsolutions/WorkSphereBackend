import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireModuleAccess } from '../../middleware/module-access.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { performanceQuerySchema } from './performance.validator';
import {
    getPerformanceSummary,
    getPerformanceTimeline,
    getPerformanceTasks,
    getPerformanceMeetings,
    getPerformanceDaily,
} from './performance.controller';

const router = Router({ mergeParams: true });

// Require authentication for all performance endpoints
router.use(authenticate);
router.use(requireModuleAccess('user-reviews'));

// ── GET /api/v1/company/users/:userId/performance ─────────────────────────────
router.get('/:userId/performance', validateRequest(performanceQuerySchema), getPerformanceSummary);
router.get('/:userId/performance/timeline', validateRequest(performanceQuerySchema), getPerformanceTimeline);
router.get('/:userId/performance/tasks', validateRequest(performanceQuerySchema), getPerformanceTasks);
router.get('/:userId/performance/meetings', validateRequest(performanceQuerySchema), getPerformanceMeetings);
router.get('/:userId/performance/daily', validateRequest(performanceQuerySchema), getPerformanceDaily);

export default router;
