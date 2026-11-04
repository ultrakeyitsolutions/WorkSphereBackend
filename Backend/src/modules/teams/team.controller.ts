
import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { TeamService } from './team.service';
import { AppError } from '../../utils/AppError';

export const createTeam = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const team = await TeamService.createTeam(companyId, userId, req.body);
    return sendSuccess(res, 'Team created successfully', team, 201);
});

export const getTeams = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const result = await TeamService.getTeams(companyId, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        search: req.query.search as string,
        departmentId: req.query.departmentId as string,
        leadId: req.query.leadId as string,
        isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    });

    return sendSuccess(res, 'Teams retrieved successfully', result);
});

export const getTeamById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { teamId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const team = await TeamService.getTeamById(companyId, teamId as string);
    return sendSuccess(res, 'Team details retrieved successfully', team);
});

export const updateTeam = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.updateTeam(companyId, teamId as string, userId, req.body);
    return sendSuccess(res, 'Team updated successfully', updated);
});

export const deleteTeam = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const result = await TeamService.deleteTeam(companyId, teamId as string, userId);
    return sendSuccess(res, 'Team archived successfully', result);
});

export const addTeamMembers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const { teamId } = req.params;
    const { memberIds } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.addMembers(companyId, teamId as string, memberIds || [], userId, userRole);
    return sendSuccess(res, 'Team members added successfully', updated);
});

export const removeTeamMembers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const { teamId } = req.params;
    const { memberIds } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.removeMembers(companyId, teamId as string, memberIds || [], userId, userRole);
    return sendSuccess(res, 'Team members removed successfully', updated);
});

export const linkTeamProjects = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    const { projectIds } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.linkProjects(companyId, teamId as string, projectIds || [], userId);
    return sendSuccess(res, 'Projects linked to team successfully', updated);
});

export const unlinkTeamProjects = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    const { projectIds } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.unlinkProjects(companyId, teamId as string, projectIds || [], userId);
    return sendSuccess(res, 'Projects unlinked from team successfully', updated);
});

export const transferTeamLead = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    const { newLeadId } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const updated = await TeamService.transferTeamLead(companyId, teamId as string, newLeadId, userId);
    return sendSuccess(res, 'Team lead transferred successfully', updated);
});

export const transferTeamMembers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const { teamId } = req.params;
    const { toTeamId, memberIds } = req.body;
    if (!companyId || !userId) throw AppError.unauthorized('Company context required');

    const result = await TeamService.transferMembers(companyId, teamId as string, toTeamId, memberIds || [], userId);
    return sendSuccess(res, 'Team members transferred successfully', result);
});

export const getTeamPerformance = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { teamId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const performance = await TeamService.getTeamPerformance(companyId, teamId as string);
    return sendSuccess(res, 'Team performance retrieved successfully', performance);
});



