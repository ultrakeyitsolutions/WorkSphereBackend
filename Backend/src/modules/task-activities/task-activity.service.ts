import { Types } from 'mongoose';
import { TaskActivity, ActivityType } from './task-activity.model';
import { Task } from '../tasks/task.model';
import { Project } from '../companyadmin/projects/project.model';

export class TaskActivityService {
    static async createActivity(taskId: string, userId: string, companyId: string, data: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const project = await Project.findOne({ _id: task.projectId, companyId });
        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        // Ideally, check if user belongs to project here, assuming already checked or we do basic validation
        // (Depends on existing logic, but we enforce companyId)

        let parentId = null;
        if (data.parentId) {
            const parent = await TaskActivity.findOne({ _id: data.parentId, taskId });
            if (!parent) {
                throw new Error('PARENT_ACTIVITY_NOT_FOUND');
            }
            parentId = parent._id;
        }

        const activity = new TaskActivity({
            companyId: new Types.ObjectId(companyId),
            projectId: task.projectId,
            taskId: task._id,
            userId: new Types.ObjectId(userId),
            type: data.type || ActivityType.COMMENT,
            content: data.content,
            parentId: parentId,
            audio: data.audio,
            video: data.video,
            routedToRole: data.routedToRole,
            routedToUserId: data.routedToUserId
        });

        await activity.save();

        return TaskActivity.findById(activity._id).populate('userId', 'id name avatar role').exec();
    }

    static async getActivities(taskId: string, companyId: string, query: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const limit = parseInt(query.limit) || 30;
        const cursor = query.cursor;

        const filter: any = { taskId: task._id, companyId };
        if (cursor) {
            filter.createdAt = { $lt: new Date(cursor as string) };
        }

        // Fetch top level activities or replies
        // If we just want all activities ordered by newest
        const activities = await TaskActivity.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .populate('userId', 'id name avatar role')
            .exec();

        let hasMore = false;
        if (activities.length > limit) {
            hasMore = true;
            activities.pop(); // remove the extra item
        }

        const nextCursor = hasMore ? activities[activities.length - 1].createdAt.toISOString() : null;

        return {
            items: activities,
            nextCursor,
            hasMore
        };
    }
}
