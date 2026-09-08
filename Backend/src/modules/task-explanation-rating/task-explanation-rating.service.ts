import { Types } from 'mongoose';
import { TaskExplanationRating, getRatingLabel, ITaskExplanationRating } from './task-explanation-rating.model';
import { Task } from '../tasks/task.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { AppError } from '../../utils/AppError';

export interface RatingSummary {
    ratings:        RatingItem[];
    average:        number | null;
    count:          number;
    taskCreatedById: string;
}

export interface RatingItem {
    id:          string;
    taskId:      string;
    ratedById:   string;
    rating:      number;
    ratingLabel: string;
    createdAt:   Date;
    updatedAt:   Date;
}

export class TaskExplanationRatingService {

    /**
     * Submit or update the authenticated user's rating for a task explanation.
     * Uses upsert so calling twice updates the previous rating.
     */
    static async upsertRating(
        companyId: string,
        userId:    string,
        taskId:    string,
        rating:    number
    ): Promise<ITaskExplanationRating> {
        // 1. Validate task exists and user has access
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');

        const canAccess = await ProjectService.canAccessProject(companyId, userId, task.projectId.toString());
        if (!canAccess) throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');

        const ratingLabel = getRatingLabel(rating);

        // 2. Upsert — one rating per user per task
        const doc = await TaskExplanationRating.findOneAndUpdate(
            {
                companyId: new Types.ObjectId(companyId),
                taskId:    new Types.ObjectId(taskId),
                ratedById: new Types.ObjectId(userId),
            },
            {
                $set: { rating, ratingLabel },
                $setOnInsert: {
                    companyId: new Types.ObjectId(companyId),
                    taskId:    new Types.ObjectId(taskId),
                    ratedById: new Types.ObjectId(userId),
                },
            },
            { upsert: true, new: true }
        );

        return doc!;
    }

    /**
     * Get all ratings for a task + aggregate summary.
     * Mirrors the reference response structure from the spec.
     */
    static async getRatingsForTask(
        companyId: string,
        userId:    string,
        taskId:    string,
        myOnly:    boolean = false
    ): Promise<RatingSummary> {
        // Validate task & access
        const task = await Task.findOne({ _id: taskId, companyId, isActive: true }).lean();
        if (!task) throw AppError.notFound('TASK_NOT_FOUND_OR_INACTIVE');

        const canAccess = await ProjectService.canAccessProject(companyId, userId, task.projectId.toString());
        if (!canAccess) throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');

        const filter: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            taskId:    new Types.ObjectId(taskId),
        };

        if (myOnly) {
            filter['ratedById'] = new Types.ObjectId(userId);
        }

        const docs = await TaskExplanationRating.find(filter).lean();

        const ratings: RatingItem[] = docs.map(d => ({
            id:          String(d._id),
            taskId:      String(d.taskId),
            ratedById:   String(d.ratedById),
            rating:      d.rating,
            ratingLabel: d.ratingLabel,
            createdAt:   d.createdAt,
            updatedAt:   d.updatedAt,
        }));

        const average = ratings.length > 0
            ? parseFloat((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(2))
            : null;

        return {
            ratings,
            average,
            count:          ratings.length,
            taskCreatedById: String(task.createdBy),
        };
    }

    /**
     * Lightweight check used internally by task-tracking:
     * Has the given user submitted a rating for this task?
     */
    static async hasUserRatedTask(companyId: string, userId: string, taskId: string): Promise<boolean> {
        const exists = await TaskExplanationRating.exists({
            companyId: new Types.ObjectId(companyId),
            taskId:    new Types.ObjectId(taskId),
            ratedById: new Types.ObjectId(userId),
        });
        return !!exists;
    }
}
