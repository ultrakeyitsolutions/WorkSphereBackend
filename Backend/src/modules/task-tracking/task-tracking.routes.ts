import { Router } from 'express';
import { TaskTrackingController } from './task-tracking.controller';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting to prevent duplicate start task requests rapidly
const trackingLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many tracking requests, please try again later.' },
});

router.post('/start', trackingLimiter, TaskTrackingController.startTracking);
router.post('/pause', TaskTrackingController.pauseTracking);
router.post('/hold', TaskTrackingController.holdTracking);
router.post('/admin-hold', TaskTrackingController.adminHoldTracking);
router.post('/resume', TaskTrackingController.resumeTracking);
router.post('/complete', TaskTrackingController.completeTracking);

router.get('/current', TaskTrackingController.getCurrentTracking);
router.get('/task/:taskId', TaskTrackingController.getTrackingByTask);

export default router;
