import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TaskBugService } from './task-bug.service';

export const createBug = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;

        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const bug = await TaskBugService.createBug(taskId, userId, companyId as string, req.body);
        return res.status(201).json({ success: true, data: bug });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getBugs = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const bugs = await TaskBugService.getBugs(taskId, companyId as string);
        return res.status(200).json({ success: true, data: bugs });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getBugById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const bugId = req.params.bugId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const bug = await TaskBugService.getBugById(bugId, companyId as string);
        return res.status(200).json({ success: true, data: bug });
    } catch (error: any) {
        if (error.message === 'BUG_NOT_FOUND') return res.status(404).json({ success: false, message: 'Bug not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const updateBug = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const bugId = req.params.bugId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const bug = await TaskBugService.updateBug(bugId, companyId as string, req.body);
        return res.status(200).json({ success: true, data: bug });
    } catch (error: any) {
        if (error.message === 'BUG_NOT_FOUND') return res.status(404).json({ success: false, message: 'Bug not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteBug = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const bugId = req.params.bugId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskBugService.deleteBug(bugId, companyId as string);
        return res.status(200).json({ success: true, message: 'Bug deleted successfully' });
    } catch (error: any) {
        if (error.message === 'BUG_NOT_FOUND') return res.status(404).json({ success: false, message: 'Bug not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
