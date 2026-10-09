import { Types } from 'mongoose';
import { TaskActivity, ActivityType } from './task-activity.model';
import { Task } from '../tasks/task.model';
import { Project } from '../companyadmin/projects/project.model';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';

export class TaskActivityService {
    private static async formatActivity(activityDoc: any) {
        if (!activityDoc) return null;
        const plain = activityDoc.toObject ? activityDoc.toObject() : { ...activityDoc };

        if (plain.audio && (plain.audio.storageKey || plain.audio.url)) {
            plain.audio.url = await StorageConfigurationService.signUrl(
                plain.audio.storageKey || plain.audio.url
            );
        }

        if (plain.video && (plain.video.storageKey || plain.video.url)) {
            plain.video.url = await StorageConfigurationService.signUrl(
                plain.video.storageKey || plain.video.url
            );
        }

        return plain;
    }

    static async createActivity(taskId: string, userId: string, companyId: string, data: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const project = await Project.findOne({ _id: task.projectId, companyId });
        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

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

        const created = await TaskActivity.findById(activity._id).populate('userId', 'id name avatar role').exec();
        return this.formatActivity(created);
    }

    static async getActivities(taskId: string, companyId: string, query: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const limit = parseInt(query.limit) || 30;
        const cursor = query.cursor;

        const filter: any = { taskId: task._id, companyId };
        if (query.type) {
            if (query.type.includes(',')) {
                filter.type = { $in: query.type.split(',').map((t: string) => t.trim().toUpperCase()) };
            } else {
                filter.type = query.type.trim().toUpperCase();
            }
        }

        if (query.parentId !== undefined) {
            filter.parentId = query.parentId === 'null' || query.parentId === '' ? null : new Types.ObjectId(query.parentId);
        }

        if (cursor) {
            filter.createdAt = { $lt: new Date(cursor as string) };
        }

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

        const formattedItems = await Promise.all(
            activities.map(act => this.formatActivity(act))
        );

        const nextCursor = hasMore && activities.length > 0 ? activities[activities.length - 1].createdAt.toISOString() : null;

        return {
            items: formattedItems,
            nextCursor,
            hasMore
        };
    }
}
