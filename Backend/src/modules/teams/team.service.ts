import { Types } from 'mongoose';
import { Team } from './team.model';
import { CreateTeamDto, UpdateTeamDto, ITeamDocument } from './team.types';
import { AppError } from '../../utils/AppError';
import { User } from '../users/user.model';
import { CompanyMember } from '../companyadmin/invitations/company-member.model';
import { Project } from '../companyadmin/projects/project.model';
import { Task } from '../tasks/task.model';
import { TeamAccessService } from '../manager/services/team-access.service';
import { FeatureRevocationService } from '../companyadmin/settings/feature-revocation.service';
import { ManagerAssignmentAudit } from '../manager/models/manager-audit.model';
import { ManagerAuditAction } from '../manager/constants/manager.constants';

export class TeamService {
    /**
     * Create a new team within the company
     */
    public static async createTeam(companyIdStr: string, creatorIdStr: string, data: CreateTeamDto): Promise<ITeamDocument> {
        const companyId = new Types.ObjectId(companyIdStr);
        const creatorId = new Types.ObjectId(creatorIdStr);

        // Check duplicate name
        const existing = await Team.findOne({ companyId, name: data.name.trim() }).lean();
        if (existing) {
            throw AppError.badRequest('A team with this name already exists in your company');
        }

        let leadId: Types.ObjectId | null = null;
        if (data.leadId) {
            if (!Types.ObjectId.isValid(data.leadId)) throw AppError.badRequest('Invalid leadId');
            leadId = new Types.ObjectId(data.leadId);
            // Verify member exists in company
            const member = await CompanyMember.findOne({ companyId, userId: leadId, status: 'ACTIVE' }).lean();
            if (!member) {
                throw AppError.badRequest('Assigned team lead is not an active member of this organization');
            }
        }

        const managerIds: Types.ObjectId[] = [];
        if (Array.isArray(data.managerIds)) {
            for (const mId of data.managerIds) {
                if (Types.ObjectId.isValid(mId)) {
                    managerIds.push(new Types.ObjectId(mId));
                }
            }
        }
        if (leadId && !managerIds.some((m) => m.equals(leadId!))) {
            managerIds.push(leadId);
        } else if (!leadId && managerIds.length > 0) {
            leadId = managerIds[0];
        }

        const memberIds: Types.ObjectId[] = [];
        if (Array.isArray(data.memberIds)) {
            for (const mId of data.memberIds) {
                if (Types.ObjectId.isValid(mId)) {
                    memberIds.push(new Types.ObjectId(mId));
                }
            }
        }

        const projectIds: Types.ObjectId[] = [];
        if (Array.isArray(data.projectIds)) {
            for (const pId of data.projectIds) {
                if (Types.ObjectId.isValid(pId)) {
                    projectIds.push(new Types.ObjectId(pId));
                }
            }
        }

        const departmentId = data.departmentId && Types.ObjectId.isValid(data.departmentId)
            ? new Types.ObjectId(data.departmentId)
            : null;

        const team = await Team.create({
            companyId,
            name: data.name.trim(),
            code: data.code ? data.code.trim().toUpperCase() : undefined,
            description: data.description ? data.description.trim() : undefined,
            departmentId,
            departmentName: data.departmentName ? data.departmentName.trim() : undefined,
            leadId,
            managerIds: Array.from(new Set(managerIds)),
            memberIds: Array.from(new Set(memberIds)),
            projectIds: Array.from(new Set(projectIds)),
            createdBy: creatorId,
            isActive: true,
            isArchived: false,
        });

        for (const mId of managerIds) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, mId.toString());
        }

        return team;
    }

    /**
     * Get teams with pagination and filtering
     */
    public static async getTeams(
        companyIdStr: string,
        query: {
            page?: number;
            limit?: number;
            search?: string;
            departmentId?: string;
            leadId?: string;
            isActive?: boolean;
            isArchived?: boolean;
            teamIds?: Types.ObjectId[];
        }
    ) {
        const companyId = new Types.ObjectId(companyIdStr);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: any = { companyId };

        if (query.isArchived !== undefined) {
            filter.isArchived = query.isArchived;
        } else {
            filter.isArchived = false;
        }

        if (query.isActive !== undefined) {
            filter.isActive = query.isActive;
        }

        if (query.departmentId && Types.ObjectId.isValid(query.departmentId)) {
            filter.departmentId = new Types.ObjectId(query.departmentId);
        }

        if (query.leadId && Types.ObjectId.isValid(query.leadId)) {
            filter.leadId = new Types.ObjectId(query.leadId);
        }

        if (query.teamIds && query.teamIds.length > 0) {
            filter._id = { $in: query.teamIds };
        }

        if (query.search && query.search.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            filter.$or = [{ name: regex }, { code: regex }, { description: regex }];
        }

        const [teams, total] = await Promise.all([
            Team.find(filter)
                .populate('leadId', 'name email avatar status')
                .populate('managerIds', 'name email avatar status')
                .populate('departmentId', 'name')
                .populate('projectIds', 'name status priority startDate endDate')
                .populate('memberIds', 'name email avatar status')
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Team.countDocuments(filter),
        ]);

        return {
            teams: teams.map((t: any) => ({
                id: t._id,
                name: t.name,
                code: t.code,
                description: t.description,
                department: t.departmentId ? { id: t.departmentId._id, name: t.departmentId.name } : null,
                departmentName: t.departmentName,
                lead: t.leadId ? { id: t.leadId._id, name: t.leadId.name, email: t.leadId.email, avatar: t.leadId.avatar } : null,
                managers: (t.managerIds && t.managerIds.length > 0 ? t.managerIds : (t.leadId ? [t.leadId] : [])).map((m: any) => ({
                    id: m._id,
                    name: m.name,
                    email: m.email,
                    avatar: m.avatar,
                    status: m.status,
                })),
                membersCount: (t.memberIds || []).length,
                members: (t.memberIds || []).map((m: any) => ({
                    id: m._id,
                    name: m.name,
                    email: m.email,
                    avatar: m.avatar,
                    status: m.status,
                })),
                projectsCount: (t.projectIds || []).length,
                projects: (t.projectIds || []).map((p: any) => ({
                    id: p._id,
                    name: p.name,
                    status: p.status,
                    priority: p.priority,
                })),
                isActive: t.isActive,
                isArchived: t.isArchived,
                createdAt: t.createdAt,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get a single team by ID
     */
    public static async getTeamById(companyIdStr: string, teamIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr })
            .populate('leadId', 'name email avatar status')
            .populate('managerIds', 'name email avatar status')
            .populate('departmentId', 'name')
            .populate('projectIds', 'name status priority startDate endDate actualEndDate')
            .populate('memberIds', 'name email avatar status lastLoginAt')
            .populate('createdBy', 'name email')
            .lean();

        if (!team) {
            throw AppError.notFound('Team not found');
        }

        return {
            id: team._id,
            name: team.name,
            code: team.code,
            description: team.description,
            department: team.departmentId ? { id: (team.departmentId as any)._id, name: (team.departmentId as any).name } : null,
            departmentName: team.departmentName,
            lead: team.leadId ? {
                id: (team.leadId as any)._id,
                name: (team.leadId as any).name,
                email: (team.leadId as any).email,
                avatar: (team.leadId as any).avatar,
                status: (team.leadId as any).status,
            } : null,
            managers: ((team.managerIds && team.managerIds.length > 0 ? team.managerIds : (team.leadId ? [team.leadId] : [])) as any[]).map((m: any) => ({
                id: m._id,
                name: m.name,
                email: m.email,
                avatar: m.avatar,
                status: m.status,
            })),
            members: (team.memberIds || []).map((m: any) => ({
                id: m._id,
                name: m.name,
                email: m.email,
                avatar: m.avatar,
                status: m.status,
                lastLoginAt: m.lastLoginAt,
            })),
            membersCount: (team.memberIds || []).length,
            projects: (team.projectIds || []).map((p: any) => ({
                id: p._id,
                name: p.name,
                status: p.status,
                priority: p.priority,
                startDate: p.startDate,
                endDate: p.endDate,
            })),
            projectsCount: (team.projectIds || []).length,
            isActive: team.isActive,
            isArchived: team.isArchived,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
        };
    }

    /**
     * Update team details
     */
    public static async updateTeam(companyIdStr: string, teamIdStr: string, updaterIdStr: string, data: UpdateTeamDto) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) {
            throw AppError.notFound('Team not found');
        }

        const oldLeadId = team.leadId ? team.leadId.toString() : null;
        const oldManagerIds = (team.managerIds || []).map((m: any) => m.toString());

        if (data.name && data.name.trim() !== team.name) {
            const duplicate = await Team.findOne({
                companyId: companyIdStr,
                name: data.name.trim(),
                _id: { $ne: team._id },
            }).lean();
            if (duplicate) throw AppError.badRequest('A team with this name already exists');
            team.name = data.name.trim();
        }

        if (data.code !== undefined) team.code = data.code ? data.code.trim().toUpperCase() : undefined;
        if (data.description !== undefined) team.description = data.description ? data.description.trim() : undefined;
        if (data.departmentId !== undefined) {
            team.departmentId = data.departmentId && Types.ObjectId.isValid(data.departmentId)
                ? new Types.ObjectId(data.departmentId)
                : null;
        }
        if (data.departmentName !== undefined) team.departmentName = data.departmentName;
        if (data.isActive !== undefined) team.isActive = data.isActive;
        if (data.isArchived !== undefined) team.isArchived = data.isArchived;

        if (data.leadId !== undefined) {
            team.leadId = data.leadId && Types.ObjectId.isValid(data.leadId)
                ? new Types.ObjectId(data.leadId)
                : null;
        }

        if (Array.isArray(data.managerIds)) {
            const parsed = data.managerIds.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id));
            if (team.leadId && !parsed.some((m) => m.equals(team.leadId!))) {
                parsed.push(team.leadId);
            }
            team.managerIds = Array.from(new Set(parsed));
        } else if (team.leadId && (!team.managerIds || team.managerIds.length === 0)) {
            team.managerIds = [team.leadId];
        }

        if (Array.isArray(data.memberIds)) {
            team.memberIds = Array.from(new Set(data.memberIds.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id))));
        }

        if (Array.isArray(data.projectIds)) {
            team.projectIds = Array.from(new Set(data.projectIds.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id))));
        }

        await team.save();

        // Invalidate scope cache for old and new lead/managers
        const affectedManagerIds = new Set<string>([...oldManagerIds, ...(team.managerIds || []).map(String)]);
        if (oldLeadId) affectedManagerIds.add(oldLeadId);
        if (team.leadId) affectedManagerIds.add(team.leadId.toString());

        for (const mId of affectedManagerIds) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, mId);
        }

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Delete / Archive a team
     */
    public static async deleteTeam(companyIdStr: string, teamIdStr: string, deleterIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) {
            throw AppError.notFound('Team not found');
        }

        const leadId = team.leadId ? team.leadId.toString() : null;

        // Archive team
        team.isArchived = true;
        team.isActive = false;
        await team.save();

        if (leadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, leadId);
            await FeatureRevocationService.revokeManagerAccess(
                companyIdStr,
                leadId,
                'REVOKE_TEAM',
                teamIdStr,
                undefined,
                'Team was archived'
            );
        }

        return { success: true, message: 'Team archived successfully' };
    }

    /**
     * Add members to team
     */
    public static async addMembers(companyIdStr: string, teamIdStr: string, memberIdsToAdd: string[], actorIdStr: string, actorRole?: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) throw AppError.notFound('Team not found');

        if (actorRole && !['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'].includes(actorRole.toUpperCase())) {
            const isLead = team.leadId && team.leadId.toString() === actorIdStr;
            const isManager = (team.managerIds || []).some((m) => m.toString() === actorIdStr);
            if (!isLead && !isManager) {
                throw AppError.forbidden('Forbidden: You can only manage members within your own assigned team');
            }
        }

        const validOids = memberIdsToAdd.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id));
        const currentSet = new Set(team.memberIds.map(String));

        for (const oid of validOids) {
            currentSet.add(oid.toString());
        }

        team.memberIds = Array.from(currentSet).map((id) => new Types.ObjectId(id));
        await team.save();

        if (team.leadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, team.leadId.toString());
        }

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Remove members from team
     */
    public static async removeMembers(companyIdStr: string, teamIdStr: string, memberIdsToRemove: string[], actorIdStr: string, actorRole?: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) throw AppError.notFound('Team not found');

        if (actorRole && !['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'].includes(actorRole.toUpperCase())) {
            const isLead = team.leadId && team.leadId.toString() === actorIdStr;
            const isManager = (team.managerIds || []).some((m) => m.toString() === actorIdStr);
            if (!isLead && !isManager) {
                throw AppError.forbidden('Forbidden: You can only manage members within your own assigned team');
            }
        }

        const removeSet = new Set(memberIdsToRemove);
        team.memberIds = team.memberIds.filter((id) => !removeSet.has(id.toString()));
        await team.save();

        if (team.leadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, team.leadId.toString());
        }

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Link projects to team
     */
    public static async linkProjects(companyIdStr: string, teamIdStr: string, projectIdsToLink: string[], actorIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) throw AppError.notFound('Team not found');

        const validOids = projectIdsToLink.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id));
        const currentSet = new Set(team.projectIds.map(String));

        for (const oid of validOids) {
            currentSet.add(oid.toString());
        }

        team.projectIds = Array.from(currentSet).map((id) => new Types.ObjectId(id));
        await team.save();

        if (team.leadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, team.leadId.toString());
        }

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Unlink projects from team
     */
    public static async unlinkProjects(companyIdStr: string, teamIdStr: string, projectIdsToUnlink: string[], actorIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) throw AppError.notFound('Team not found');

        const removeSet = new Set(projectIdsToUnlink);
        team.projectIds = team.projectIds.filter((id) => !removeSet.has(id.toString()));
        await team.save();

        if (team.leadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, team.leadId.toString());
        }

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Transfer team leadership / ownership
     */
    public static async transferTeamLead(companyIdStr: string, teamIdStr: string, newLeadIdStr: string, actorIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');
        if (!Types.ObjectId.isValid(newLeadIdStr)) throw AppError.badRequest('Invalid newLeadId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr });
        if (!team) throw AppError.notFound('Team not found');

        const newLead = await CompanyMember.findOne({ companyId: companyIdStr, userId: newLeadIdStr, status: 'ACTIVE' });
        if (!newLead) throw AppError.badRequest('New lead is not an active member of this organization');

        const oldLeadId = team.leadId ? team.leadId.toString() : null;
        team.leadId = new Types.ObjectId(newLeadIdStr);
        await team.save();

        // Audit log
        await ManagerAssignmentAudit.create({
            companyId: new Types.ObjectId(companyIdStr),
            managerId: new Types.ObjectId(newLeadIdStr),
            action: ManagerAuditAction.TEAM_TRANSFERRED,
            previousState: { teamId: teamIdStr, leadId: oldLeadId },
            newState: { teamId: teamIdStr, leadId: newLeadIdStr },
            actorId: new Types.ObjectId(actorIdStr),
            reason: 'Team lead transferred by administrator',
            affectedResources: { teamIds: [teamIdStr] },
        });

        // Invalidate scope cache for both old and new leads
        if (oldLeadId) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, oldLeadId);
            await FeatureRevocationService.revokeManagerAccess(
                companyIdStr,
                oldLeadId,
                'REVOKE_TEAM',
                teamIdStr,
                undefined,
                'Team leadership transferred'
            );
        }
        await TeamAccessService.invalidateScopeCache(companyIdStr, newLeadIdStr);

        return this.getTeamById(companyIdStr, teamIdStr);
    }

    /**
     * Transfer members from one team to another
     */
    public static async transferMembers(
        companyIdStr: string,
        fromTeamIdStr: string,
        toTeamIdStr: string,
        memberIdsToTransfer: string[],
        actorIdStr: string
    ) {
        if (!Types.ObjectId.isValid(fromTeamIdStr) || !Types.ObjectId.isValid(toTeamIdStr)) {
            throw AppError.badRequest('Invalid team IDs');
        }
        if (fromTeamIdStr === toTeamIdStr) {
            throw AppError.badRequest('Source and destination teams must be different');
        }
        if (!Array.isArray(memberIdsToTransfer) || memberIdsToTransfer.length === 0) {
            throw AppError.badRequest('No members specified for transfer');
        }

        const [fromTeam, toTeam] = await Promise.all([
            Team.findOne({ _id: fromTeamIdStr, companyId: companyIdStr }),
            Team.findOne({ _id: toTeamIdStr, companyId: companyIdStr }),
        ]);

        if (!fromTeam) throw AppError.notFound('Source team not found');
        if (!toTeam) throw AppError.notFound('Destination team not found');

        const transferOids = memberIdsToTransfer.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id));
        const transferSet = new Set(transferOids.map(String));

        // Remove from source team
        fromTeam.memberIds = (fromTeam.memberIds || []).filter((id) => !transferSet.has(id.toString()));
        await fromTeam.save();

        // Add to destination team
        const destSet = new Set((toTeam.memberIds || []).map(String));
        transferOids.forEach((id) => destSet.add(id.toString()));
        toTeam.memberIds = Array.from(destSet).map((id) => new Types.ObjectId(id));
        await toTeam.save();

        // Invalidate manager scopes for both teams
        const affectedManagers = new Set<string>();
        if (fromTeam.leadId) affectedManagers.add(fromTeam.leadId.toString());
        (fromTeam.managerIds || []).forEach((m: any) => affectedManagers.add(m.toString()));
        if (toTeam.leadId) affectedManagers.add(toTeam.leadId.toString());
        (toTeam.managerIds || []).forEach((m: any) => affectedManagers.add(m.toString()));

        for (const mId of affectedManagers) {
            await TeamAccessService.invalidateScopeCache(companyIdStr, mId);
        }

        return {
            sourceTeam: await this.getTeamById(companyIdStr, fromTeamIdStr),
            destinationTeam: await this.getTeamById(companyIdStr, toTeamIdStr),
            transferredCount: transferOids.length,
        };
    }

    /**
     * Get Team Performance metrics
     */
    public static async getTeamPerformance(companyIdStr: string, teamIdStr: string) {
        if (!Types.ObjectId.isValid(teamIdStr)) throw AppError.badRequest('Invalid teamId');

        const team = await Team.findOne({ _id: teamIdStr, companyId: companyIdStr })
            .populate('memberIds', 'name email avatar status')
            .populate('projectIds', 'name status')
            .lean();

        if (!team) throw AppError.notFound('Team not found');

        const memberOids = (team.memberIds || []).map((m: any) => m._id);
        const projectOids = (team.projectIds || []).map((p: any) => (p._id ? p._id : p));

        // Calculate tasks count for team members and team projects using actual DB records.
        // Task model uses `statusId` (ref to Status) + `completedDate`, not a denormalized `status` field.
        const tasks = await Task.find({
            companyId: new Types.ObjectId(companyIdStr),
            isArchived: { $ne: true },
            $or: [
                { assignedToId: { $in: memberOids } },
                { projectId: { $in: projectOids } },
            ],
        })
            .populate('statusId', 'name')
            .select('statusId dueDate completedAt assignedToId projectId')
            .lean();

        const totalTasks = tasks.length;
        const now = new Date();
        let completedTasks = 0;
        let pendingTasks = 0;
        let inProgressTasks = 0;
        let overdueTasks = 0;

        for (const task of tasks as any[]) {
            const statusDoc = (task as any).statusId;
            const statusName = (statusDoc && typeof statusDoc === 'object' ? (statusDoc as any).name : (statusDoc as any)) || '';
            // Normalize spaces/underscores so 'In Progress', 'In_Progress', 'IN PROGRESS' all match.
            const statusNorm = String(statusName).toUpperCase().replace(/[\s_]+/g, '_');
            const hasCompletedDate = !!(task as any).completedDate;
            const isCompleted = hasCompletedDate || /^(COMPLETED|DONE|CLOSED)$/.test(statusNorm);
            const isCancelled = /^CANCELLED$/.test(statusNorm);
            const dueDate = (task as any).dueDate ? new Date((task as any).dueDate) : null;
            const isOverdue = !isCompleted && !isCancelled && !!dueDate && dueDate < now;

            if (isCompleted) {
                completedTasks++;
            } else {
                if (/^(IN_PROGRESS|WORKING|ACTIVE)$/.test(statusNorm)) {
                    inProgressTasks++;
                } else {
                    pendingTasks++;
                }
                if (isOverdue) {
                    overdueTasks++;
                }
            }
        }

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        return {
            teamId: team._id,
            teamName: team.name,
            membersCount: memberOids.length,
            projectsCount: projectOids.length,
            metrics: {
                totalTasks,
                completedTasks,
                pendingTasks,
                inProgressTasks,
                overdueTasks,
                completionRate,
            },
        };
    }
}
export default TeamService;
