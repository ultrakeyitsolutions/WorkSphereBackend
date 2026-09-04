import { Router } from 'express';
import { addReaction, removeReaction } from './task-reaction.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { addReactionSchema, reactionParamSchema } from './task-reaction.validator';

const router = Router({ mergeParams: true });

// Mounted at /api/v1/company/task-activities/:activityId/reactions

router.post('/', validateRequest(addReactionSchema), addReaction);
router.delete('/:reaction', validateRequest(reactionParamSchema), removeReaction);

export default router;
