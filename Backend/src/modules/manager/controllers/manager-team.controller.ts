import { Response } from 'express';
import { ManagerRequest } from '../middleware/manager-access.middleware';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerInspectionService } from '../services/manager-inspection.service';

export const getTeams = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const result = await ManagerInspectionService.getAuthorizedTeams(scope);
    return sendSuccess(res, 'Authorized teams retrieved successfully', result);
});

export const getTeamById = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { teamId } = req.params;
    const result = await ManagerInspectionService.getTeamDetails(scope, teamId as string);
    return sendSuccess(res, 'Team details retrieved successfully', result);
});

export const getTeamMembers = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { teamId } = req.params;
    const result = await ManagerInspectionService.getTeamMembers(scope, teamId as string);
    return sendSuccess(res, 'Team members retrieved successfully', result);
});

export const getTeamOverview = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { teamId } = req.params;
    const result = await ManagerInspectionService.getTeamOverview(scope, teamId as string);
    return sendSuccess(res, 'Team overview metrics retrieved successfully', result);
});

export const getTeamActivity = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { teamId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    const result = await ManagerInspectionService.getTeamActivity(scope, teamId as string, limit);
    return sendSuccess(res, 'Team activity retrieved successfully', result);
});

export const getTeamPerformance = catchAsync(async (req: ManagerRequest, res: Response) => {
    const scope = req.managerScope!;
    const { teamId } = req.params;
    const result = await ManagerInspectionService.getTeamPerformance(scope, teamId as string);
    return sendSuccess(res, 'Team performance breakdown retrieved successfully', result);
});
