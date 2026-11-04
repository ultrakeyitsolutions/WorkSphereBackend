import { Types } from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { ManagerAssignment, IManagerAssignmentDocument } from '../models/manager-assignment.model';
import { ManagerPermission } from '../models/manager-permission.model';
import { ManagerAssignmentAudit } from '../models/manager-audit.model';
import { Team } from '../../teams/team.model';
import { User } from '../../users/user.model';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { Project } from '../../companyadmin/projects/project.model';
import {
    ManagerAssignmentType,
    ManagerAccessLevel,
    ManagerAuditAction,
    DEFAULT_MANAGER_PERMISSIONS,
} from '../constants/manager.constants';
import { TeamAccessService } from './team-access.service';
import { FeatureRevocationService } from '../../companyadmin/settings/feature-revocation.service';
import { NotificationEventBus } from '../../notifications/notification.event-bus';

export class ManagerAssignmentService {
    /**
     * List all managers in the company with assignment summaries
     */
    public static async listManagers(
        companyIdStr: string,
        query: {
            page?: number;
            limit?: number;
            search?: string;
            status?: string;
        }
    ) {
        const companyId = new Types.ObjectId(companyIdStr);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        // Find members with memberType 'MANAGER' or users with active manager assignments
        const activeAssignmentManagerIds = await ManagerAssignment.distinct('managerId', {
            companyId,
            isActive: true,
        });

        const memberFilter: any = {
            companyId,
            $or: [
                { memberType: 'MANAGER' },
                { userId: { $in: activeAssignmentManagerIds } },
            ],
        };

        if (query.status && query.status.toUpperCase() !== 'ALL') {
            memberFilter.status = query.status.toUpperCase();
        }

        const [members, total] = await Promise.all([
            CompanyMember.find(memberFilter)
                .populate('userId', 'name email avatar phoneNumber status updatedAt')
                .populate('designationId', 'name')
                .populate('roleId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            CompanyMember.countDocuments(memberFilter),
        ]);

        const managerUserIds = members.map((m: any) => m.userId?._id).filter(Boolean);

        // Fetch active assignments, permissions, and led teams
        const [assignments, permissions, ledTeams] = await Promise.all([
            ManagerAssignment.find({
                companyId,
                managerId: { $in: managerUserIds },
                isActive: true,
            })
                .populate('teamId', 'name code')
                .populate('projectId', 'name')
                .populate('employeeId', 'name email avatar')
                .lean(),
            ManagerPermission.find({
                companyId,
                managerId: { $in: managerUserIds },
            }).lean(),
            Team.find({
                companyId,
                leadId: { $in: managerUserIds },
                isArchived: false,
            }).select('name code leadId').lean(),
        ]);

        const permissionMap = new Map<string, any>();
        permissions.forEach((p) => permissionMap.set(String(p.managerId), p));

        const data = members.map((m: any) => {
            const user = m.userId;
            const uId = String(user?._id || '');
            const mAssignments = assignments.filter((a) => String(a.managerId) === uId);
            const mLedTeams = ledTeams.filter((t) => String(t.leadId) === uId);
            const mPerm = permissionMap.get(uId);

            const primaryTeams = mAssignments
                .filter((a) => a.assignmentType === ManagerAssignmentType.PRIMARY_TEAM && a.teamId)
                .map((a: any) => ({ id: a.teamId._id, name: a.teamId.name, code: a.teamId.code }));

            // Add teams where user is leadId directly
            mLedTeams.forEach((lt) => {
                if (!primaryTeams.some((pt) => String(pt.id) === String(lt._id))) {
                    primaryTeams.push({ id: lt._id, name: lt.name, code: lt.code });
                }
            });

            const additionalTeams = mAssignments
                .filter((a) => a.assignmentType === ManagerAssignmentType.ADDITIONAL_TEAM && a.teamId)
                .map((a: any) => ({ id: a.teamId._id, name: a.teamId.name, code: a.teamId.code }));

            const individualEmployees = mAssignments
                .filter((a) => a.assignmentType === ManagerAssignmentType.INDIVIDUAL_EMPLOYEE && a.employeeId)
                .map((a: any) => ({ id: a.employeeId._id, name: a.employeeId.name, email: a.employeeId.email }));

            const assignedProjects = mAssignments
                .filter((a) => a.assignmentType === ManagerAssignmentType.PROJECT_SPECIFIC && a.projectId)
                .map((a: any) => ({ id: a.projectId._id, name: a.projectId.name }));

            return {
                id: m._id,
                managerId: user?._id,
                name: user?.name,
                email: user?.email,
                avatar: user?.avatar,
                phoneNumber: user?.phoneNumber,
                status: user?.status,
                memberType: m.memberType,
                designation: m.designationId ? { id: m.designationId._id, name: m.designationId.name } : null,
                role: m.roleId ? { id: m.roleId._id, name: m.roleId.name } : null,
                isSuspended: !!mPerm?.isSuspended,
                suspensionReason: mPerm?.suspensionReason || null,
                assignmentsCount: mAssignments.length,
                primaryTeams,
                additionalTeams,
                individualEmployees,
                assignedProjects,
                lastLoginAt: user?.lastLoginAt,
                joinedAt: m.joinedAt,
            };
        });

        return {
            managers: data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get a manager's complete profile, active assignments, and permissions
     */
    public static async getManagerDetails(companyIdStr: string, managerIdStr: string) {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);

        const [user, member, permission, assignments, ledTeams] = await Promise.all([
            User.findById(managerId).select('-password').populate('role').lean(),
            CompanyMember.findOne({ companyId, userId: managerId })
                .populate('designationId', 'name')
                .populate('roleId', 'name')
                .lean(),
            ManagerPermission.findOne({ companyId, managerId }).lean(),
            ManagerAssignment.find({ companyId, managerId, isActive: true })
                .populate('teamId', 'name code description')
                .populate('projectId', 'name status priority startDate endDate')
                .populate('employeeId', 'name email avatar')
                .populate('departmentId', 'name')
                .populate('assignedBy', 'name email')
                .lean(),
            Team.find({ companyId, leadId: managerId, isArchived: false }).lean(),
        ]);

        if (!user || !member) {
            throw AppError.notFound('Manager member not found in this company');
        }

        return {
            manager: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                phoneNumber: user.phoneNumber,
                status: user.status,
                memberType: member.memberType,
                designation: member.designationId,
                role: member.roleId,
                joinedAt: member.joinedAt,
            },
            permissions: {
                permissions: permission?.permissions || DEFAULT_MANAGER_PERMISSIONS,
                restrictions: permission?.restrictions || [],
                isSuspended: !!permission?.isSuspended,
                suspendedAt: permission?.suspendedAt || null,
                suspensionReason: permission?.suspensionReason || null,
            },
            assignments: assignments.map((a: any) => ({
                id: a._id,
                assignmentType: a.assignmentType,
                accessLevel: a.accessLevel,
                team: a.teamId ? { id: a.teamId._id, name: a.teamId.name, code: a.teamId.code } : null,
                project: a.projectId ? { id: a.projectId._id, name: a.projectId.name, status: a.projectId.status } : null,
                employee: a.employeeId ? { id: a.employeeId._id, name: a.employeeId.name, email: a.employeeId.email } : null,
                department: a.departmentId ? { id: a.departmentId._id, name: a.departmentId.name } : null,
                permissions: a.permissions,
                startDate: a.startDate,
                endDate: a.endDate,
                assignedBy: a.assignedBy ? { id: a.assignedBy._id, name: a.assignedBy.name } : null,
                createdAt: a.createdAt,
            })),
            ledTeams: ledTeams.map((t) => ({ id: t._id, name: t.name, code: t.code })),
        };
    }

    /**
     * Promote an employee to Manager
     */
    public static async promoteToManager(
        companyIdStr: string,
        employeeIdStr: string,
        actorIdStr: string,
        data: {
            initialTeamId?: string;
            permissions?: string[];
        }
    ) {
        if (!Types.ObjectId.isValid(employeeIdStr)) throw AppError.badRequest('Invalid employee ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const employeeId = new Types.ObjectId(employeeIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        const member = await CompanyMember.findOne({ companyId, userId: employeeId, status: 'ACTIVE' });
        if (!member) {
            throw AppError.notFound('Active employee member not found in this company');
        }

        const previousMemberType = member.memberType;
        member.memberType = 'MANAGER';
        await member.save();

        // Setup manager permissions
        const requestedPermissions = Array.isArray(data.permissions) && data.permissions.length > 0
            ? data.permissions
            : DEFAULT_MANAGER_PERMISSIONS;

        let permDoc = await ManagerPermission.findOne({ companyId, managerId: employeeId });
        if (!permDoc) {
            permDoc = await ManagerPermission.create({
                companyId,
                managerId: employeeId,
                permissions: requestedPermissions,
                restrictions: [],
                isSuspended: false,
                grantedBy: actorId,
                updatedBy: actorId,
            });
        } else {
            permDoc.permissions = requestedPermissions;
            permDoc.isSuspended = false;
            permDoc.updatedBy = actorId;
            await permDoc.save();
        }

        let assignedTeamId: string | null = null;
        if (data.initialTeamId && Types.ObjectId.isValid(data.initialTeamId)) {
            const team = await Team.findOne({ _id: data.initialTeamId, companyId, isArchived: false });
            if (team) {
                // Create PRIMARY_TEAM assignment
                await ManagerAssignment.create({
                    companyId,
                    managerId: employeeId,
                    assignmentType: ManagerAssignmentType.PRIMARY_TEAM,
                    teamId: team._id,
                    accessLevel: ManagerAccessLevel.FULL,
                    permissions: [],
                    isActive: true,
                    startDate: new Date(),
                    assignedBy: actorId,
                });
                team.leadId = employeeId;
                await team.save();
                assignedTeamId = team._id.toString();
            }
        }

        // Record Audit Log
        await ManagerAssignmentAudit.create({
            companyId,
            managerId: employeeId,
            action: ManagerAuditAction.PROMOTED_TO_MANAGER,
            previousState: { memberType: previousMemberType },
            newState: { memberType: 'MANAGER', initialTeamId: assignedTeamId },
            actorId,
            reason: 'Employee promoted to Manager by administrator',
            affectedResources: { teamIds: assignedTeamId ? [assignedTeamId] : [] },
        });

        await TeamAccessService.invalidateScopeCache(companyIdStr, employeeIdStr);

        return this.getManagerDetails(companyIdStr, employeeIdStr);
    }

    /**
     * Create an assignment for a manager (Team, Additional Team, Employee, Project, Department)
     */
    public static async createAssignment(
        companyIdStr: string,
        managerIdStr: string,
        actorIdStr: string,
        data: {
            assignmentType: ManagerAssignmentType;
            teamId?: string;
            employeeId?: string;
            projectId?: string;
            departmentId?: string;
            accessLevel?: ManagerAccessLevel;
            permissions?: string[];
            startDate?: Date;
            endDate?: Date | null;
        }
    ): Promise<IManagerAssignmentDocument> {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        // Verify manager exists
        const member = await CompanyMember.findOne({ companyId, userId: managerId, status: 'ACTIVE' });
        if (!member) throw AppError.notFound('Manager not found');

        const teamId = data.teamId && Types.ObjectId.isValid(data.teamId) ? new Types.ObjectId(data.teamId) : null;
        const employeeId = data.employeeId && Types.ObjectId.isValid(data.employeeId) ? new Types.ObjectId(data.employeeId) : null;
        const projectId = data.projectId && Types.ObjectId.isValid(data.projectId) ? new Types.ObjectId(data.projectId) : null;
        const departmentId = data.departmentId && Types.ObjectId.isValid(data.departmentId) ? new Types.ObjectId(data.departmentId) : null;

        // Validation based on type
        if (
            (data.assignmentType === ManagerAssignmentType.PRIMARY_TEAM ||
                data.assignmentType === ManagerAssignmentType.ADDITIONAL_TEAM) &&
            !teamId
        ) {
            throw AppError.badRequest('teamId is required for team assignment');
        }

        if (data.assignmentType === ManagerAssignmentType.INDIVIDUAL_EMPLOYEE && !employeeId) {
            throw AppError.badRequest('employeeId is required for individual employee assignment');
        }

        if (data.assignmentType === ManagerAssignmentType.PROJECT_SPECIFIC && !projectId) {
            throw AppError.badRequest('projectId is required for project assignment');
        }

        if (data.assignmentType === ManagerAssignmentType.DEPARTMENT && !departmentId) {
            throw AppError.badRequest('departmentId is required for department assignment');
        }

        // Check if an active duplicate assignment exists
        const duplicate = await ManagerAssignment.findOne({
            companyId,
            managerId,
            assignmentType: data.assignmentType,
            teamId,
            employeeId,
            projectId,
            isActive: true,
        });

        if (duplicate) {
            throw AppError.badRequest('An active assignment for this resource already exists for this manager');
        }

        const assignment = await ManagerAssignment.create({
            companyId,
            managerId,
            assignmentType: data.assignmentType,
            teamId,
            employeeId,
            projectId,
            departmentId,
            accessLevel: data.accessLevel || ManagerAccessLevel.FULL,
            permissions: data.permissions || [],
            isActive: true,
            startDate: data.startDate || new Date(),
            endDate: data.endDate || null,
            assignedBy: actorId,
        });

        // If PRIMARY_TEAM, update team's leadId if not set
        if (data.assignmentType === ManagerAssignmentType.PRIMARY_TEAM && teamId) {
            await Team.updateOne({ _id: teamId, companyId }, { $set: { leadId: managerId } });
        }

        // Audit Log
        let auditAction = ManagerAuditAction.ASSIGNMENT_CREATED;
        if (data.assignmentType === ManagerAssignmentType.PRIMARY_TEAM) auditAction = ManagerAuditAction.TEAM_ASSIGNED;
        else if (data.assignmentType === ManagerAssignmentType.ADDITIONAL_TEAM) auditAction = ManagerAuditAction.ADDITIONAL_TEAM_GRANTED;
        else if (data.assignmentType === ManagerAssignmentType.INDIVIDUAL_EMPLOYEE) auditAction = ManagerAuditAction.EMPLOYEE_ACCESS_GRANTED;
        else if (data.assignmentType === ManagerAssignmentType.PROJECT_SPECIFIC) auditAction = ManagerAuditAction.PROJECT_ACCESS_GRANTED;
        else if (data.assignmentType === ManagerAssignmentType.DEPARTMENT) auditAction = ManagerAuditAction.DEPARTMENT_ASSIGNED;

        await ManagerAssignmentAudit.create({
            companyId,
            managerId,
            assignmentId: assignment._id,
            action: auditAction,
            newState: assignment.toObject(),
            actorId,
            reason: 'Assignment created by administrator',
            affectedResources: {
                teamIds: teamId ? [teamId.toString()] : [],
                employeeIds: employeeId ? [employeeId.toString()] : [],
                projectIds: projectId ? [projectId.toString()] : [],
            },
        });

        // Invalidate scope cache
        await TeamAccessService.invalidateScopeCache(companyIdStr, managerIdStr);

        return assignment;
    }

    /**
     * Update an existing assignment (accessLevel, dates, permissions)
     */
    public static async updateAssignment(
        companyIdStr: string,
        managerIdStr: string,
        assignmentIdStr: string,
        actorIdStr: string,
        data: {
            accessLevel?: ManagerAccessLevel;
            permissions?: string[];
            startDate?: Date;
            endDate?: Date | null;
        }
    ) {
        if (!Types.ObjectId.isValid(assignmentIdStr)) throw AppError.badRequest('Invalid assignment ID');

        const assignment = await ManagerAssignment.findOne({
            _id: assignmentIdStr,
            companyId: companyIdStr,
            managerId: managerIdStr,
        });

        if (!assignment) {
            throw AppError.notFound('Assignment not found');
        }

        const previousState = assignment.toObject();

        if (data.accessLevel) assignment.accessLevel = data.accessLevel;
        if (data.permissions) assignment.permissions = data.permissions;
        if (data.startDate) assignment.startDate = data.startDate;
        if (data.endDate !== undefined) assignment.endDate = data.endDate;

        await assignment.save();

        await ManagerAssignmentAudit.create({
            companyId: new Types.ObjectId(companyIdStr),
            managerId: new Types.ObjectId(managerIdStr),
            assignmentId: assignment._id,
            action: ManagerAuditAction.ASSIGNMENT_UPDATED,
            previousState,
            newState: assignment.toObject(),
            actorId: new Types.ObjectId(actorIdStr),
            reason: 'Assignment updated by administrator',
        });

        await TeamAccessService.invalidateScopeCache(companyIdStr, managerIdStr);

        return assignment;
    }

    /**
     * Revoke an assignment (with real-time cache invalidation, audit history, and socket eviction)
     */
    public static async revokeAssignment(
        companyIdStr: string,
        managerIdStr: string,
        assignmentIdStr: string,
        actorIdStr: string,
        reason?: string
    ) {
        if (!Types.ObjectId.isValid(assignmentIdStr)) throw AppError.badRequest('Invalid assignment ID');

        const assignment = await ManagerAssignment.findOne({
            _id: assignmentIdStr,
            companyId: companyIdStr,
            managerId: managerIdStr,
            isActive: true,
        });

        if (!assignment) {
            throw AppError.notFound('Active assignment not found');
        }

        const previousState = typeof assignment.toObject === 'function' ? assignment.toObject() : { ...assignment };
        assignment.isActive = false;
        assignment.revokedAt = new Date();
        assignment.revokedBy = new Types.ObjectId(actorIdStr);
        assignment.revocationReason = reason || 'Revoked by administrator';
        await assignment.save();

        // Audit Log
        await ManagerAssignmentAudit.create({
            companyId: new Types.ObjectId(companyIdStr),
            managerId: new Types.ObjectId(managerIdStr),
            assignmentId: assignment._id,
            action: ManagerAuditAction.ASSIGNMENT_REVOKED,
            previousState,
            newState: typeof assignment.toObject === 'function' ? assignment.toObject() : { ...assignment },
            actorId: new Types.ObjectId(actorIdStr),
            reason: reason || 'Assignment revoked by administrator',
            affectedResources: {
                teamIds: assignment.teamId ? [assignment.teamId.toString()] : [],
                employeeIds: assignment.employeeId ? [assignment.employeeId.toString()] : [],
                projectIds: assignment.projectId ? [assignment.projectId.toString()] : [],
            },
        });

        // Determine revocation action for real-time socket eviction
        let revAction: 'REVOKE_TEAM' | 'REVOKE_EMPLOYEE' | 'REVOKE_PROJECT' = 'REVOKE_TEAM';
        let targetId: string | undefined = assignment.teamId?.toString();

        if (assignment.assignmentType === ManagerAssignmentType.INDIVIDUAL_EMPLOYEE) {
            revAction = 'REVOKE_EMPLOYEE';
            targetId = assignment.employeeId?.toString();
        } else if (assignment.assignmentType === ManagerAssignmentType.PROJECT_SPECIFIC) {
            revAction = 'REVOKE_PROJECT';
            targetId = assignment.projectId?.toString();
        }

        // Multi-worker real-time revocation + scope cache invalidation
        await FeatureRevocationService.revokeManagerAccess(
            companyIdStr,
            managerIdStr,
            revAction,
            targetId,
            undefined,
            reason
        );

        return { success: true, message: 'Assignment revoked successfully' };
    }

    /**
     * Temporarily suspend a manager's access
     */
    public static async suspendManager(
        companyIdStr: string,
        managerIdStr: string,
        actorIdStr: string,
        reason: string
    ) {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        let perm = await ManagerPermission.findOne({ companyId, managerId });
        if (!perm) {
            perm = await ManagerPermission.create({
                companyId,
                managerId,
                permissions: DEFAULT_MANAGER_PERMISSIONS,
                restrictions: [],
                isSuspended: true,
                suspendedAt: new Date(),
                suspendedBy: actorId,
                suspensionReason: reason,
                grantedBy: actorId,
                updatedBy: actorId,
            });
        } else {
            perm.isSuspended = true;
            perm.suspendedAt = new Date();
            perm.suspendedBy = actorId;
            perm.suspensionReason = reason;
            perm.updatedBy = actorId;
            await perm.save();
        }

        await ManagerAssignmentAudit.create({
            companyId,
            managerId,
            action: ManagerAuditAction.MANAGER_SUSPENDED,
            newState: { isSuspended: true, reason },
            actorId,
            reason,
        });

        await FeatureRevocationService.revokeManagerAccess(
            companyIdStr,
            managerIdStr,
            'SUSPEND',
            undefined,
            undefined,
            reason
        );

        return { success: true, message: 'Manager access suspended successfully' };
    }

    /**
     * Reinstate a suspended manager
     */
    public static async reinstateManager(companyIdStr: string, managerIdStr: string, actorIdStr: string) {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        const perm = await ManagerPermission.findOne({ companyId, managerId });
        if (perm) {
            perm.isSuspended = false;
            perm.suspendedAt = null;
            perm.suspendedBy = null;
            perm.suspensionReason = null;
            perm.updatedBy = actorId;
            await perm.save();
        }

        await ManagerAssignmentAudit.create({
            companyId,
            managerId,
            action: ManagerAuditAction.MANAGER_REINSTATED,
            newState: { isSuspended: false },
            actorId,
            reason: 'Manager access reinstated by administrator',
        });

        await TeamAccessService.invalidateScopeCache(companyIdStr, managerIdStr);

        return { success: true, message: 'Manager access reinstated successfully' };
    }

    /**
     * Demote a Manager back to Employee:
     * - Revokes manager-specific permissions
     * - Deactivates all active manager assignments
     * - Updates CompanyMember.memberType to 'EMPLOYEE'
     * - Retains personal projects, tasks, attendance, and complete historical audit records!
     */
    public static async demoteManager(
        companyIdStr: string,
        managerIdStr: string,
        actorIdStr: string,
        reason?: string
    ) {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        // Update memberType
        const member = await CompanyMember.findOne({ companyId, userId: managerId });
        if (member) {
            member.memberType = 'EMPLOYEE';
            await member.save();
        }

        // Deactivate all active assignments
        const updateResult = await ManagerAssignment.updateMany(
            { companyId, managerId, isActive: true },
            {
                $set: {
                    isActive: false,
                    revokedAt: new Date(),
                    revokedBy: actorId,
                    revocationReason: reason || 'Demoted from manager role',
                },
            }
        );

        // Update ManagerPermission
        await ManagerPermission.updateOne(
            { companyId, managerId },
            { $set: { permissions: [], restrictions: [], isSuspended: false, updatedBy: actorId } }
        );

        // Record Audit Log
        await ManagerAssignmentAudit.create({
            companyId,
            managerId,
            action: ManagerAuditAction.DEMOTED_FROM_MANAGER,
            previousState: { memberType: 'MANAGER', deactivatedAssignmentsCount: updateResult.modifiedCount || 0 },
            newState: { memberType: 'EMPLOYEE' },
            actorId,
            reason: reason || 'Manager privileges revoked by administrator',
        });

        // Trigger real-time demotion event across all workers & socket eviction
        await FeatureRevocationService.revokeManagerAccess(
            companyIdStr,
            managerIdStr,
            'DEMOTE',
            undefined,
            undefined,
            reason || 'Manager privileges revoked'
        );

        return {
            success: true,
            message: 'Manager successfully demoted to regular employee. Personal data and history preserved.',
        };
    }

    /**
     * Update a manager's granular permissions
     */
    public static async updatePermissions(
        companyIdStr: string,
        managerIdStr: string,
        actorIdStr: string,
        permissions: string[],
        restrictions: string[] = []
    ) {
        if (!Types.ObjectId.isValid(managerIdStr)) throw AppError.badRequest('Invalid manager ID');

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const actorId = new Types.ObjectId(actorIdStr);

        let perm = await ManagerPermission.findOne({ companyId, managerId });
        const previousPermissions = perm?.permissions || [];

        if (!perm) {
            perm = await ManagerPermission.create({
                companyId,
                managerId,
                permissions,
                restrictions,
                isSuspended: false,
                grantedBy: actorId,
                updatedBy: actorId,
            });
        } else {
            perm.permissions = permissions;
            perm.restrictions = restrictions;
            perm.updatedBy = actorId;
            await perm.save();
        }

        await ManagerAssignmentAudit.create({
            companyId,
            managerId,
            action: ManagerAuditAction.PERMISSIONS_UPDATED,
            previousState: { permissions: previousPermissions },
            newState: { permissions, restrictions },
            actorId,
            reason: 'Manager permissions updated by administrator',
            affectedResources: { permissionNames: permissions },
        });

        await FeatureRevocationService.revokeManagerAccess(
            companyIdStr,
            managerIdStr,
            'PERMISSIONS_UPDATED',
            undefined,
            permissions
        );

        return perm;
    }

    /**
     * Get assignment history & audit logs
     */
    public static async getAuditHistory(
        companyIdStr: string,
        managerIdStr: string,
        query: { page?: number; limit?: number }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter = {
            companyId: new Types.ObjectId(companyIdStr),
            managerId: new Types.ObjectId(managerIdStr),
        };

        const [records, total] = await Promise.all([
            ManagerAssignmentAudit.find(filter)
                .populate('actorId', 'name email avatar')
                .populate('assignmentId')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ManagerAssignmentAudit.countDocuments(filter),
        ]);

        return {
            records: records.map((r: any) => ({
                id: r._id,
                action: r.action,
                previousState: r.previousState,
                newState: r.newState,
                actor: r.actorId ? { id: r.actorId._id, name: r.actorId.name, email: r.actorId.email } : null,
                reason: r.reason,
                affectedResources: r.affectedResources,
                createdAt: r.createdAt,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}
export default ManagerAssignmentService;
