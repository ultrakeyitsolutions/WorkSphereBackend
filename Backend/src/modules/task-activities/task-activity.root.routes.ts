import { Router } from 'express';
import { createReply, uploadAudio, uploadVideo } from './task-activity.controller';
import taskReactionRoutes from '../task-reactions/task-reaction.routes';
import { validateRequest } from '../../middleware/validateRequest';
import { createReplySchema } from './task-activity.validator';

const router = Router();

// Mounted at /api/v1/company/task-activities

router.post('/:activityId/replies', validateRequest(createReplySchema), createReply);
router.use('/:activityId/reactions', taskReactionRoutes);
router.post('/:activityId/audio', uploadAudio);
router.post('/:activityId/video', uploadVideo);

export default router;
