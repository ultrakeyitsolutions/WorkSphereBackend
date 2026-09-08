import { Router } from 'express';
import { TaskExplanationRatingController } from './task-explanation-rating.controller';

const router = Router();

// POST /api/v1/company/task-explanation-ratings        — submit / update rating
router.post('/', TaskExplanationRatingController.submitRating);

// GET  /api/v1/company/task-explanation-ratings?taskId=xxx&myOnly=false
router.get('/', TaskExplanationRatingController.getRatings);

export default router;
