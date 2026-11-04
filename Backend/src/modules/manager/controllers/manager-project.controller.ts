import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerProjectService } from '../services/manager-project.service';

export const getProjects = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerProjectService.getProjects(scope, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        status: req.query.status as string,
        search: req.query.search as string,
    });
    return sendSuccess(res, 'Accessible projects retrieved successfully', result);
});

export const getProjectById = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { projectId } = req.params;
    const result = await ManagerProjectService.getProjectDetails(scope, projectId as string);
    return sendSuccess(res, 'Project details retrieved successfully', result);
});

export const getProjectMembers = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { projectId } = req.params;
    const result = await ManagerProjectService.getProjectMembers(scope, projectId as string);
    return sendSuccess(res, 'Project members retrieved successfully', result);
});

export const getProjectTasks = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { projectId } = req.params;
    const result = await ManagerProjectService.getProjectTasks(scope, projectId as string, {
        statusId: req.query.statusId as string,
        priority: req.query.priority as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    return sendSuccess(res, 'Project tasks retrieved successfully', result);
});

export const getProjectReport = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { projectId } = req.params;
    const result = await ManagerProjectService.getProjectReport(scope, projectId as string);
    return sendSuccess(res, 'Project report retrieved successfully', result);
});

export const getProjectActivity = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { projectId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    const result = await ManagerProjectService.getProjectActivity(scope, projectId as string, limit);
    return sendSuccess(res, 'Project activity retrieved successfully', result);
});
