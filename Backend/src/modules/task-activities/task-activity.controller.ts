import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TaskActivityService } from './task-activity.service';
import { TaskActivity } from './task-activity.model';

export const createActivity = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;

        if (!companyId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const activity = await TaskActivityService.createActivity(taskId, userId, companyId as string, req.body);
        return res.status(201).json({ success: true, data: activity });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'PARENT_ACTIVITY_NOT_FOUND') return res.status(404).json({ success: false, message: 'Parent activity not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getActivities = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;

        if (!companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await TaskActivityService.getActivities(taskId, companyId as string, req.query);
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const createReply = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const activityId = req.params.activityId as string;

        if (!companyId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        
        const parent = await TaskActivity.findOne({ _id: activityId, companyId });
        if (!parent) {
            return res.status(404).json({ success: false, message: 'Parent activity not found' });
        }

        const replyData = {
            ...req.body,
            parentId: parent._id.toString()
        };

        const reply = await TaskActivityService.createActivity(parent.taskId.toString(), userId, companyId as string, replyData);
        return res.status(201).json({ success: true, data: reply });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const uploadAudio = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const activityId = req.params.activityId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // Update the activity with audio metadata
        const activity = await TaskActivity.findOneAndUpdate(
            { _id: activityId, companyId },
            { $set: { audio: req.body.audio } },
            { new: true }
        );
        if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });
        return res.status(200).json({ success: true, data: activity });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const uploadVideo = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const activityId = req.params.activityId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // Update the activity with video metadata
        const activity = await TaskActivity.findOneAndUpdate(
            { _id: activityId, companyId },
            { $set: { video: req.body.video } },
            { new: true }
        );
        if (!activity) return res.status(404).json({ success: false, message: 'Activity not found' });
        return res.status(200).json({ success: true, data: activity });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
