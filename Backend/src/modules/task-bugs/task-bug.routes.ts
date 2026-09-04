import { Router } from 'express';
import { createBug, getBugs } from './task-bug.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { createBugSchema } from './task-bug.validator';

const router = Router({ mergeParams: true });

// Mounted at /api/v1/company/tasks/:taskId/bugs

router.post('/', validateRequest(createBugSchema), createBug);
router.get('/', getBugs);

export default router;
