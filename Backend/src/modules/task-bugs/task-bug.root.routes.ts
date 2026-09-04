import { Router } from 'express';
import { getBugById, updateBug, deleteBug } from './task-bug.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { updateBugSchema, bugParamSchema } from './task-bug.validator';

const router = Router();

// Mounted at /api/v1/company/task-bugs

router.get('/:bugId', validateRequest(bugParamSchema), getBugById);
router.patch('/:bugId', validateRequest(updateBugSchema), updateBug);
router.delete('/:bugId', validateRequest(bugParamSchema), deleteBug);

export default router;
