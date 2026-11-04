import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerTaskService } from '../services/manager-task.service';

export const getTasks = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerTaskService.getTasks(scope, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        projectId: req.query.projectId as string,
        employeeId: req.query.employeeId as string,
        statusId: req.query.statusId as string,
        priority: req.query.priority as string,
        isOverdue: req.query.isOverdue === 'true',
        isBlocked: req.query.isBlocked === 'true',
        isReopened: req.query.isReopened === 'true',
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
    });
    return sendSuccess(res, 'Tasks retrieved successfully', result);
});

export const getTaskById = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { taskId } = req.params;
    const result = await ManagerTaskService.getTaskById(scope, taskId as string);
    return sendSuccess(res, 'Task details retrieved successfully', result);
});

export const createTask = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerTaskService.createTask(scope, req.body);
    return sendSuccess(res, 'Task created successfully', result, 201);
});

export const updateTask = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { taskId } = req.params;
    const result = await ManagerTaskService.updateTask(scope, taskId as string, req.body);
    return sendSuccess(res, 'Task updated successfully', result);
});

export const assignTask = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { taskId } = req.params;
    const { assignedToId } = req.body;
    const result = await ManagerTaskService.assignTask(scope, taskId as string, assignedToId);
    return sendSuccess(res, 'Task assigned successfully', result);
});

export const updateTaskStatus = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { taskId } = req.params;
    const { statusId } = req.body;
    const result = await ManagerTaskService.updateStatus(scope, taskId as string, statusId);
    return sendSuccess(res, 'Task status updated successfully', result);
});

export const updateTaskPriority = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { taskId } = req.params;
    const { priority } = req.body;
    const result = await ManagerTaskService.updatePriority(scope, taskId as string, priority);
    return sendSuccess(res, 'Task priority updated successfully', result);
});
