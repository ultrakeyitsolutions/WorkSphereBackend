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

        // projectId may come from the route param (POST /projects/:projectId/tasks)
        // or embedded in the body (POST /tasks directly)
        const bodyWithProject = {
            ...req.body,
            projectId: req.params.projectId || req.body.projectId
        };

        const result = await TaskService.createTask(bodyWithProject, companyId as string, userId as string);

        return res.status(201).json({
            success: true,
            data: result
        });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        if (error.message === 'PERMISSION_DENIED') {
            return res.status(403).json({ success: false, message: 'You do not have permission to create tasks for this project' });
        }
        if (error.message === 'ASSIGNEE_NOT_IN_PROJECT') {
            return res.status(400).json({ success: false, message: 'Assigned user is not part of the project' });
        }
        if (error.message === 'FEATURE_NOT_AVAILABLE') {
            return res.status(403).json({
                success: false,
                code: 'FEATURE_NOT_AVAILABLE',
                feature: 'RECURRING_TASKS',
                message: 'Your current plan does not support recurring tasks.',
                action: 'UPGRADE_PLAN'
            });
        }
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getTasksByProject = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const projectId = req.params.projectId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const tasks = await TaskService.getTasksByProject(projectId, companyId as string, req.query as any, userId);
        return res.status(200).json({ success: true, data: tasks });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'PERMISSION_DENIED') return res.status(403).json({ success: false, message: 'You do not have permission to access tasks for this project' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getTaskById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const task = await TaskService.getTaskById(taskId, companyId as string);
        return res.status(200).json({ success: true, data: task });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const updateTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const task = await TaskService.updateTask(taskId, req.body, companyId as string, userId as string);
        return res.status(200).json({ success: true, data: task });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'ASSIGNEE_NOT_IN_PROJECT') return res.status(400).json({ success: false, message: 'Assigned user is not part of the project' });
        if (error.message === 'FEATURE_NOT_AVAILABLE') return res.status(403).json({ success: false, code: 'FEATURE_NOT_AVAILABLE', feature: 'RECURRING_TASKS', message: 'Your current plan does not support recurring tasks.', action: 'UPGRADE_PLAN' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskService.deleteTask(taskId, companyId as string);
        return res.status(200).json({ success: true, message: 'Task deleted successfully' });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getTaskRecurrence = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const rule = await TaskService.getTaskRecurrence(taskId, companyId as string);
        return res.status(200).json({ success: true, data: rule });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const updateTaskRecurrence = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const rule = await TaskService.updateTaskRecurrence(taskId, req.body, companyId as string);
        return res.status(200).json({ success: true, data: rule });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'NOT_RECURRING') return res.status(400).json({ success: false, message: 'Task is not recurring' });
        if (error.message === 'RULE_NOT_FOUND') return res.status(404).json({ success: false, message: 'Recurring rule not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteTaskRecurrence = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskService.deleteTaskRecurrence(taskId, companyId as string);
        return res.status(200).json({ success: true, message: 'Task recurrence deleted successfully' });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const cancelTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const task = await TaskService.cancelTask(taskId, companyId as string, userId as string, req.body?.reason);
        return res.status(200).json({ success: true, message: 'Task cancelled successfully', data: task });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const reopenTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await TaskService.reopenTask(
            taskId,
            req.body,
            companyId as string,
            userId as string
        );
        return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'TASK_NOT_COMPLETED' || error.message === 'TASK_NOT_COMPLETED_OR_CANCELLED') {
            return res.status(400).json({ success: false, message: 'Task can only be reopened when it is in Completed or Cancelled state' });
        }
        if (error.message === 'ASSIGNEE_NOT_IN_PROJECT') return res.status(400).json({ success: false, message: 'Assigned user is not part of the project' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getProjectMembers = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const projectId = req.params.projectId as string;
        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const members = await TaskService.getProjectMembers(projectId, companyId as string);
        return res.status(200).json({ success: true, data: members });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getArchivedTasks = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await TaskService.getArchivedTasks(companyId as string, userId as string, req.query as any);
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'PERMISSION_DENIED') return res.status(403).json({ success: false, message: 'You do not have permission to view archived tasks for this project' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getArchivedTasksByProject = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const projectId = req.params.projectId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const query = { ...req.query, projectId };
        const result = await TaskService.getArchivedTasks(companyId as string, userId as string, query);
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'PERMISSION_DENIED') return res.status(403).json({ success: false, message: 'You do not have permission to view archived tasks for this project' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const archiveTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await TaskService.archiveTask(taskId, companyId as string, userId as string);
        return res.status(200).json({ success: true, message: result.message, data: result });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'TASK_ALREADY_ARCHIVED') return res.status(400).json({ success: false, message: 'Task is already archived' });
        if (error.message === 'PERMISSION_DENIED') return res.status(403).json({ success: false, message: 'You do not have permission to archive this task' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const unarchiveTask = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;
        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const result = await TaskService.unarchiveTask(taskId, companyId as string, userId as string);
        return res.status(200).json({ success: true, message: result.message, data: result });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        if (error.message === 'PROJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Project not found' });
        if (error.message === 'TASK_NOT_ARCHIVED') return res.status(400).json({ success: false, message: 'Task is not archived' });
        if (error.message === 'PERMISSION_DENIED') return res.status(403).json({ success: false, message: 'You do not have permission to unarchive this task' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
