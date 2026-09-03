import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TaskService } from './task.service';

export const getTaskContext = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const projectId = req.params.projectId as string;

        if (!companyId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const context = await TaskService.getTaskContext(projectId, companyId as string, userId as string);

        return res.status(200).json({
            success: true,
            data: context
        });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const createTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;

        if (!companyId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await TaskService.createTask(req.body, companyId as string, userId as string);

        return res.status(201).json({
            success: true,
            data: result
        });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        if (error.message === 'PERMISSION_DENIED') {
            return res.status(403).json({ success: false, message: 'Cannot create tasks in this project' });
        }
        if (error.message === 'ASSIGNEE_NOT_IN_PROJECT') {
            return res.status(400).json({ success: false, message: 'Assigned user is not part of the project' });
        }
        if (error.message === 'FEATURE_NOT_AVAILABLE') {
            return res.status(403).json({
                success: false,
                code: 'FEATURE_NOT_AVAILABLE',
                feature: 'RECURRING_TASKS',
                message: 'Your current plan does not support recurring tasks.'
            });
        }
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
