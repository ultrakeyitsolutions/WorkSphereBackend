import { Router } from 'express';
import { validateRequest } from '../../middleware/validateRequest';
import { createTaskSchema } from './task.validator';
import { createTask } from './task.controller';

const router = Router();

// POST /api/v1/company/tasks
router.post('/', validateRequest(createTaskSchema), createTask);

export default router;
