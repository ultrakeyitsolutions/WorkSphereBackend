import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { TaskExplanationRatingService } from './task-explanation-rating.service';

export class TaskExplanationRatingController {

    /**
     * POST /api/v1/company/task-explanation-ratings
     * Body: { taskId: string, rating: number (1-5) }
     *
     * Submit or update the authenticated user's rating for a task explanation.
     */
    static submitRating = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId    = req.user?.userId;
        const { taskId, rating } = req.body;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId)               throw AppError.badRequest('taskId is required');
        if (rating === undefined)  throw AppError.badRequest('rating is required');

        const ratingNum = Number(rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            throw AppError.badRequest('rating must be an integer between 1 and 5');
        }

        const doc = await TaskExplanationRatingService.upsertRating(companyId, userId, taskId, ratingNum);
        sendSuccess(res, 'Rating submitted successfully.', { rating: doc }, 200);
    });

    /**
     * GET /api/v1/company/task-explanation-ratings?taskId=xxx&myOnly=false
     *
     * Returns all ratings for a task (or only the current user's if myOnly=true).
     * Response structure mirrors the spec reference format.
     */
    static getRatings = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId    = req.user?.userId;
        const taskId    = req.query.taskId as string;
        const myOnly    = req.query.myOnly === 'true';

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId)               throw AppError.badRequest('taskId query param is required');

        const summary = await TaskExplanationRatingService.getRatingsForTask(companyId, userId, taskId, myOnly);
        sendSuccess(res, 'Task ratings retrieved.', summary, 200);
    });
}
