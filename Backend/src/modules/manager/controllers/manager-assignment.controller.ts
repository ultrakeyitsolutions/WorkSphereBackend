import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { ManagerAssignmentService } from '../services/manager-assignment.service';
import { ManagerAssignment } from '../models/manager-assignment.model';
import { ManagerPermission } from '../models/manager-permission.model';
import { TeamService } from '../../teams/team.service';
import { AppError } from '../../../utils/AppError';
import { DEFAULT_MANAGER_PERMISSIONS } from '../constants/manager.constants';
import { MemberService } from '../../companyadmin/members/member.service';

export const getManagers = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const result = await ManagerAssignmentService.listManagers(companyId, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        search: req.query.search as string,
        status: req.query.status as string,
    });

    return sendSuccess(res, 'Managers retrieved successfully', result);
});

export const getManagerById = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const result = await ManagerAssignmentService.getManagerDetails(companyId, managerId as string);
    return sendSuccess(res, 'Manager details retrieved successfully', result);
});

export const promoteToManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { employeeId, initialTeamId, permissions } = req.body;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await ManagerAssignmentService.promoteToManager(companyId, employeeId, actorId, {
        initialTeamId,
        permissions,
    });

    return sendSuccess(res, 'Employee successfully promoted to Manager', result, 201);
});

export const demoteManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId } = req.params;
    const { reason } = req.body;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await ManagerAssignmentService.demoteManager(companyId, managerId as string, actorId, reason);
    return sendSuccess(res, result.message, result);
});

export const getAssignments = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const assignments = await ManagerAssignment.find({
        companyId,
        managerId,
    })
        .populate('teamId', 'name code')
        .populate('projectId', 'name status')
        .populate('employeeId', 'name email avatar')
        .populate('departmentId', 'name')
        .populate('assignedBy', 'name email')
        .populate('revokedBy', 'name email')
        .sort({ createdAt: -1 })
        .lean();

    return sendSuccess(res, 'Assignments retrieved successfully', assignments);
});

export const createAssignment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId } = req.params;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const assignment = await ManagerAssignmentService.createAssignment(
        companyId,
        managerId as string,
        actorId,
        req.body
    );

    return sendSuccess(res, 'Assignment created successfully', assignment, 201);
});

export const updateAssignment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId, assignmentId } = req.params;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const updated = await ManagerAssignmentService.updateAssignment(
        companyId,
        managerId as string,
        assignmentId as string,
        actorId,
        req.body
    );

    return sendSuccess(res, 'Assignment updated successfully', updated);
});

export const revokeAssignment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId, assignmentId } = req.params;
    const { reason } = req.body || {};
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await ManagerAssignmentService.revokeAssignment(
        companyId,
        managerId as string,
        assignmentId as string,
        actorId,
        reason
    );

    return sendSuccess(res, result.message, result);
});

export const suspendManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId } = req.params;
    const { reason } = req.body;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await ManagerAssignmentService.suspendManager(
        companyId,
        managerId as string,
        actorId,
        reason || 'Suspended by administrator'
    );

    return sendSuccess(res, result.message, result);
});

export const reinstateManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId } = req.params;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await ManagerAssignmentService.reinstateManager(companyId, managerId as string, actorId);
    return sendSuccess(res, result.message, result);
});

export const getPermissions = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const perm = await ManagerPermission.findOne({ companyId, managerId }).lean();
    return sendSuccess(res, 'Manager permissions retrieved', {
        permissions: perm?.permissions || DEFAULT_MANAGER_PERMISSIONS,
        restrictions: perm?.restrictions || [],
        isSuspended: !!perm?.isSuspended,
    });
});

export const updatePermissions = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { managerId } = req.params;
    const { permissions, restrictions } = req.body;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const updated = await ManagerAssignmentService.updatePermissions(
        companyId,
        managerId as string,
        actorId,
        permissions || [],
        restrictions || []
    );

    return sendSuccess(res, 'Manager permissions updated successfully', updated);
});

export const getAuditHistory = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const result = await ManagerAssignmentService.getAuditHistory(companyId, managerId as string, {
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    return sendSuccess(res, 'Audit history retrieved successfully', result);
});

export const transferTeamOwnership = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const actorId = req.user?.userId;
    const { teamId, newLeadId } = req.body;
    if (!companyId || !actorId) throw AppError.unauthorized('Authentication context required');

    const result = await TeamService.transferTeamLead(companyId, teamId, newLeadId, actorId);
    return sendSuccess(res, 'Team ownership successfully transferred', result);
});

export const updateManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const updated = await MemberService.updateMember(companyId, managerId as string, req.body);
    return sendSuccess(res, 'Manager updated', updated);
});

export const deleteManager = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = req.user?.companyId;
    const { managerId } = req.params;
    if (!companyId) throw AppError.unauthorized('Company context required');

    const result = await MemberService.deleteMember(companyId, managerId as string);
    return sendSuccess(res, 'Manager deleted', result);
});
