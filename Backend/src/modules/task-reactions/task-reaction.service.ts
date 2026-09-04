import { Types } from 'mongoose';
import { TaskReaction } from './task-reaction.model';
import { TaskActivity } from '../task-activities/task-activity.model';

export class TaskReactionService {
    static async addReaction(activityId: string, userId: string, companyId: string, reaction: string) {
        const activity = await TaskActivity.findOne({ _id: activityId, companyId });
        if (!activity) {
            throw new Error('ACTIVITY_NOT_FOUND');
        }

        try {
            const newReaction = new TaskReaction({
                companyId: new Types.ObjectId(companyId),
                projectId: activity.projectId,
                taskId: activity.taskId,
                activityId: activity._id,
                userId: new Types.ObjectId(userId),
                reaction
            });

            await newReaction.save();
            return newReaction;
        } catch (error: any) {
            if (error.code === 11000) {
                // Duplicate reaction
                throw new Error('REACTION_ALREADY_EXISTS');
            }
            throw error;
        }
    }

    static async removeReaction(activityId: string, userId: string, companyId: string, reaction: string) {
        const result = await TaskReaction.findOneAndDelete({ activityId, userId, reaction, companyId });
        if (!result) {
            throw new Error('REACTION_NOT_FOUND');
        }
        return true;
    }
}
