import { Router } from 'express';
// import { validateRequest } from '../../middleware/validateRequest';
import { createActivity, getActivities } from './task-activity.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { createActivitySchema } from './task-activity.validator';

const router = Router({ mergeParams: true }); // Make sure we can access taskId

// Mounted at /api/v1/company/tasks/:taskId/activities

router.post('/', validateRequest(createActivitySchema), createActivity);
router.get('/', getActivities);

export default router;
