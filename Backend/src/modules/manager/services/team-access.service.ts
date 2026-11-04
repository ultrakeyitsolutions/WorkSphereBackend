import { Types } from 'mongoose';
import { getRedisClient } from '../../../config/redis';
import { AppError } from '../../../utils/AppError';
import { ManagerAssignment } from '../models/manager-assignment.model';
import { ManagerPermission } from '../models/manager-permission.model';
import { Team } from '../../teams/team.model';
import { Project, ProjectInCharge, ProjectTeamMember } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { User } from '../../users/user.model';
import { CompanyMember } from '../../companyadmin/invitations/company-member.model';
import { ManagerAssignmentType, ManagerPermissionKey, ALL_MANAGER_PERMISSION_KEYS } from '../constants/manager.constants';

export interface ManagerAccessScope {
    companyId: Types.ObjectId;
    managerId: Types.ObjectId;
    isCompanyAdmin: boolean;
    isSuperAdmin: boolean;
    isSuspended: boolean;
    permissions: string[];
    primaryTeamIds: Types.ObjectId[];
    additionalTeamIds: Types.ObjectId[];
    allTeamIds: Types.ObjectId[];
    directEmployeeIds: Types.ObjectId[];
    teamEmployeeIds: Types.ObjectId[];
    allAccessibleEmployeeIds: Types.ObjectId[];
    explicitProjectIds: Types.ObjectId[];
    teamProjectIds: Types.ObjectId[];
    allAccessibleProjectIds: Types.ObjectId[];
    cachedAt: number;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes TTL
const memoryScopeCache = new Map<string, { scope: ManagerAccessScope; expiresAt: number }>();

export class TeamAccessService {
    private static getCacheKey(companyId: string, managerId: string): string {
        return `worksphere:cache:manager_scope:${companyId}:${managerId}`;
    }

    /**
     * Clear all in-memory scope cache (useful for testing and cluster synchronization)
     */
    public static clearAllMemoryCache(): void {
        memoryScopeCache.clear();
    }

    /**
     * Invalidate both Redis and in-memory cache for a manager
     */
    public static async invalidateScopeCache(companyId: string, managerId: string): Promise<void> {
        const cacheKey = this.getCacheKey(companyId, managerId);
        memoryScopeCache.delete(cacheKey);

        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                await redis.del(cacheKey).catch(() => {});
            }
        } catch (err: any) {
            console.warn('[TeamAccessService] Redis cache invalidation error:', err?.message);
        }
    }

    /**
     * Resolve complete authorized scope for a manager or admin
     */
    public static async resolveScope(
        companyIdStr: string,
        managerIdStr: string,
        callerRole?: string
    ): Promise<ManagerAccessScope> {
        if (!companyIdStr || !Types.ObjectId.isValid(companyIdStr)) {
            throw AppError.badRequest('Invalid company context');
        }
        if (!managerIdStr || !Types.ObjectId.isValid(managerIdStr)) {
            throw AppError.badRequest('Invalid manager identity');
        }

        const companyId = new Types.ObjectId(companyIdStr);
        const managerId = new Types.ObjectId(managerIdStr);
        const cacheKey = this.getCacheKey(companyIdStr, managerIdStr);

        // Check in-memory cache first
        const memCached = memoryScopeCache.get(cacheKey);
        if (memCached && memCached.expiresAt > Date.now()) {
            return memCached.scope;
        }

        // Check Redis cache next
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const redisData = await redis.get(cacheKey).catch(() => null);
                if (redisData) {
                    const parsed = JSON.parse(redisData);
                    const scope: ManagerAccessScope = {
                        companyId: new Types.ObjectId(parsed.companyId),
                        managerId: new Types.ObjectId(parsed.managerId),
                        isCompanyAdmin: parsed.isCompanyAdmin,
                        isSuperAdmin: parsed.isSuperAdmin,
                        isSuspended: parsed.isSuspended,
                        permissions: parsed.permissions,
                        primaryTeamIds: parsed.primaryTeamIds.map((id: string) => new Types.ObjectId(id)),
                        additionalTeamIds: parsed.additionalTeamIds.map((id: string) => new Types.ObjectId(id)),
                        allTeamIds: parsed.allTeamIds.map((id: string) => new Types.ObjectId(id)),
                        directEmployeeIds: parsed.directEmployeeIds.map((id: string) => new Types.ObjectId(id)),
                        teamEmployeeIds: parsed.teamEmployeeIds.map((id: string) => new Types.ObjectId(id)),
                        allAccessibleEmployeeIds: parsed.allAccessibleEmployeeIds.map((id: string) => new Types.ObjectId(id)),
                        explicitProjectIds: parsed.explicitProjectIds.map((id: string) => new Types.ObjectId(id)),
                        teamProjectIds: parsed.teamProjectIds.map((id: string) => new Types.ObjectId(id)),
                        allAccessibleProjectIds: parsed.allAccessibleProjectIds.map((id: string) => new Types.ObjectId(id)),
                        cachedAt: parsed.cachedAt,
                    };
                    memoryScopeCache.set(cacheKey, { scope, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
                    return scope;
                }
            }
        } catch {
            // Non-blocking fallback to DB resolution
        }

        // Fetch User and Member records
        const [userDoc, memberDoc, permissionDoc] = await Promise.all([
            User.findById(managerId).populate('role').lean(),
            CompanyMember.findOne({ companyId, userId: managerId }).lean(),
            ManagerPermission.findOne({ companyId, managerId }).lean(),
        ]);

        if (!userDoc) {
            throw AppError.unauthorized('User record not found');
        }

        const roleObj = (userDoc as any).role;
        const roleName = ((typeof roleObj === 'string' ? roleObj : roleObj?.name) || callerRole || '').toUpperCase();
        const isSuperAdmin = roleName === 'SUPER_ADMIN';
        const isCompanyAdmin = isSuperAdmin || roleName === 'COMPANY_ADMIN' || roleName === 'ADMIN';

        // Check suspension
        const isSuspended = !!permissionDoc?.isSuspended || userDoc.status === 'SUSPENDED';

        // Base permissions
        let effectivePermissions: string[] = [];
        if (isCompanyAdmin) {
            // Full administrative access
            effectivePermissions = [...ALL_MANAGER_PERMISSION_KEYS];
        } else if (permissionDoc) {
            const restrictions = new Set(permissionDoc.restrictions || []);
            effectivePermissions = (permissionDoc.permissions || []).filter((p) => !restrictions.has(p));
        }

        // If CompanyAdmin / SuperAdmin: Return full company access
        if (isCompanyAdmin) {
            const [allTeams, allMembers, allProjects] = await Promise.all([
                Team.find({ companyId, isArchived: false }).select('_id').lean(),
                CompanyMember.find({ companyId, status: 'ACTIVE' }).select('userId').lean(),
                Project.find({ companyId, deletedAt: null }).select('_id').lean(),
            ]);

            const allTeamIds = allTeams.map((t) => t._id as Types.ObjectId);
            const allAccessibleEmployeeIds = allMembers.map((m) => m.userId as Types.ObjectId);
            const allAccessibleProjectIds = allProjects.map((p) => p._id as Types.ObjectId);

            const scope: ManagerAccessScope = {
                companyId,
                managerId,
                isCompanyAdmin: true,
                isSuperAdmin,
                isSuspended: false,
                permissions: effectivePermissions,
                primaryTeamIds: allTeamIds,
                additionalTeamIds: [],
                allTeamIds,
                directEmployeeIds: allAccessibleEmployeeIds,
                teamEmployeeIds: allAccessibleEmployeeIds,
                allAccessibleEmployeeIds,
                explicitProjectIds: allAccessibleProjectIds,
                teamProjectIds: allAccessibleProjectIds,
                allAccessibleProjectIds,
                cachedAt: Date.now(),
            };

            await this.cacheScope(cacheKey, scope);
            return scope;
        }

        // If regular user or suspended manager
        if (isSuspended) {
            const emptyScope: ManagerAccessScope = {
                companyId,
                managerId,
                isCompanyAdmin: false,
                isSuperAdmin: false,
                isSuspended: true,
                permissions: [],
                primaryTeamIds: [],
                additionalTeamIds: [],
                allTeamIds: [],
                directEmployeeIds: [],
                teamEmployeeIds: [],
                allAccessibleEmployeeIds: [],
                explicitProjectIds: [],
                teamProjectIds: [],
                allAccessibleProjectIds: [],
                cachedAt: Date.now(),
            };
            await this.cacheScope(cacheKey, emptyScope);
            return emptyScope;
        }

        // Fetch all active assignments for this manager in this company
        const now = new Date();
        const activeAssignments = await ManagerAssignment.find({
            companyId,
            managerId,
            isActive: true,
            startDate: { $lte: now },
            $or: [{ endDate: null }, { endDate: { $gt: now } }],
        }).lean();

        const primaryTeamIdSet = new Set<string>();
        const additionalTeamIdSet = new Set<string>();
        const directEmployeeIdSet = new Set<string>();
        const explicitProjectIdSet = new Set<string>();
        const departmentIdSet = new Set<string>();

        // Also check if this manager is directly assigned as leadId or in managerIds on any Team
        const leadTeams = await Team.find({
            companyId,
            $or: [{ leadId: managerId }, { managerIds: managerId }],
            isActive: true,
            isArchived: false,
        })
            .select('_id')
            .lean();
        leadTeams.forEach((t) => primaryTeamIdSet.add(String(t._id)));

        // Categorize assignments
        for (const a of activeAssignments) {
            if (a.assignmentType === ManagerAssignmentType.PRIMARY_TEAM && a.teamId) {
                primaryTeamIdSet.add(String(a.teamId));
            } else if (a.assignmentType === ManagerAssignmentType.ADDITIONAL_TEAM && a.teamId) {
                additionalTeamIdSet.add(String(a.teamId));
            } else if (a.assignmentType === ManagerAssignmentType.INDIVIDUAL_EMPLOYEE && a.employeeId) {
                directEmployeeIdSet.add(String(a.employeeId));
            } else if (a.assignmentType === ManagerAssignmentType.PROJECT_SPECIFIC && a.projectId) {
                explicitProjectIdSet.add(String(a.projectId));
            } else if (a.assignmentType === ManagerAssignmentType.DEPARTMENT && a.departmentId) {
                departmentIdSet.add(String(a.departmentId));
            }
        }

        // If department assignments exist, add teams belonging to those departments
        if (departmentIdSet.size > 0) {
            const deptTeams = await Team.find({
                companyId,
                departmentId: { $in: Array.from(departmentIdSet).map((id) => new Types.ObjectId(id)) },
                isActive: true,
                isArchived: false,
            })
                .select('_id')
                .lean();
            deptTeams.forEach((t) => additionalTeamIdSet.add(String(t._id)));
        }

        const allTeamIdSet = new Set<string>([...primaryTeamIdSet, ...additionalTeamIdSet]);
        const allTeamIds = Array.from(allTeamIdSet).map((id) => new Types.ObjectId(id));

        // Fetch team members and team projects for all assigned teams
        const teamEmployeeIdSet = new Set<string>();
        const teamProjectIdSet = new Set<string>();

        if (allTeamIds.length > 0) {
            const teams = await Team.find({
                _id: { $in: allTeamIds },
                companyId,
                isActive: true,
                isArchived: false,
            })
                .select('memberIds projectIds leadId')
                .lean();

            for (const t of teams) {
                if (t.leadId) teamEmployeeIdSet.add(String(t.leadId));
                if (Array.isArray(t.memberIds)) {
                    t.memberIds.forEach((mId) => teamEmployeeIdSet.add(String(mId)));
                }
                if (Array.isArray(t.projectIds)) {
                    t.projectIds.forEach((pId) => teamProjectIdSet.add(String(pId)));
                }
            }
        }

        // Also check ProjectInCharge: projects where manager is in-charge
        const inChargeProjects = await ProjectInCharge.find({ userId: managerId }).select('projectId').lean();
        inChargeProjects.forEach((ic) => explicitProjectIdSet.add(String(ic.projectId)));

        // Combine employees (union of direct employees and team members)
        const allAccessibleEmployeeIdSet = new Set<string>([
            ...directEmployeeIdSet,
            ...teamEmployeeIdSet,
        ]);

        // Combine projects (union of explicit projects and team projects)
        const allAccessibleProjectIdSet = new Set<string>([
            ...explicitProjectIdSet,
            ...teamProjectIdSet,
        ]);

        const scope: ManagerAccessScope = {
            companyId,
            managerId,
            isCompanyAdmin: false,
            isSuperAdmin: false,
            isSuspended,
            permissions: effectivePermissions,
            primaryTeamIds: Array.from(primaryTeamIdSet).map((id) => new Types.ObjectId(id)),
            additionalTeamIds: Array.from(additionalTeamIdSet).map((id) => new Types.ObjectId(id)),
            allTeamIds,
            directEmployeeIds: Array.from(directEmployeeIdSet).map((id) => new Types.ObjectId(id)),
            teamEmployeeIds: Array.from(teamEmployeeIdSet).map((id) => new Types.ObjectId(id)),
            allAccessibleEmployeeIds: Array.from(allAccessibleEmployeeIdSet).map((id) => new Types.ObjectId(id)),
            explicitProjectIds: Array.from(explicitProjectIdSet).map((id) => new Types.ObjectId(id)),
            teamProjectIds: Array.from(teamProjectIdSet).map((id) => new Types.ObjectId(id)),
            allAccessibleProjectIds: Array.from(allAccessibleProjectIdSet).map((id) => new Types.ObjectId(id)),
            cachedAt: Date.now(),
        };

        await this.cacheScope(cacheKey, scope);
        return scope;
    }

    private static async cacheScope(cacheKey: string, scope: ManagerAccessScope): Promise<void> {
        memoryScopeCache.set(cacheKey, { scope, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });

        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const serializable = {
                    companyId: scope.companyId.toString(),
                    managerId: scope.managerId.toString(),
                    isCompanyAdmin: scope.isCompanyAdmin,
                    isSuperAdmin: scope.isSuperAdmin,
                    isSuspended: scope.isSuspended,
                    permissions: scope.permissions,
                    primaryTeamIds: scope.primaryTeamIds.map((id) => id.toString()),
                    additionalTeamIds: scope.additionalTeamIds.map((id) => id.toString()),
                    allTeamIds: scope.allTeamIds.map((id) => id.toString()),
                    directEmployeeIds: scope.directEmployeeIds.map((id) => id.toString()),
                    teamEmployeeIds: scope.teamEmployeeIds.map((id) => id.toString()),
                    allAccessibleEmployeeIds: scope.allAccessibleEmployeeIds.map((id) => id.toString()),
                    explicitProjectIds: scope.explicitProjectIds.map((id) => id.toString()),
                    teamProjectIds: scope.teamProjectIds.map((id) => id.toString()),
                    allAccessibleProjectIds: scope.allAccessibleProjectIds.map((id) => id.toString()),
                    cachedAt: scope.cachedAt,
                };
                await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(serializable)).catch(() => {});
            }
        } catch {
            // Ignore redis caching failure
        }
    }

    // ─── Resource Access Checks ───────────────────────────────────────────────

    public static async canAccessTeam(companyId: string, managerId: string, teamId: string): Promise<boolean> {
        const scope = await this.resolveScope(companyId, managerId);
        if (scope.isCompanyAdmin) return true;
        if (scope.isSuspended) return false;
        return scope.allTeamIds.some((id) => id.toString() === teamId);
    }

    public static async assertTeamAccess(companyId: string, managerId: string, teamId: string): Promise<void> {
        const allowed = await this.canAccessTeam(companyId, managerId, teamId);
        if (!allowed) {
            throw AppError.forbidden('Forbidden: You do not have access to this team');
        }
    }

    public static async canAccessEmployee(companyId: string, managerId: string, employeeId: string): Promise<boolean> {
        const scope = await this.resolveScope(companyId, managerId);
        if (scope.isCompanyAdmin) return true;
        if (scope.isSuspended) return false;
        return scope.allAccessibleEmployeeIds.some((id) => id.toString() === employeeId);
    }

    public static async assertEmployeeAccess(companyId: string, managerId: string, employeeId: string): Promise<void> {
        const allowed = await this.canAccessEmployee(companyId, managerId, employeeId);
        if (!allowed) {
            throw AppError.forbidden('Forbidden: You do not have access to this employee');
        }
    }

    public static async canAccessProject(companyId: string, managerId: string, projectId: string): Promise<boolean> {
        const scope = await this.resolveScope(companyId, managerId);
        if (scope.isCompanyAdmin) return true;
        if (scope.isSuspended) return false;
        return scope.allAccessibleProjectIds.some((id) => id.toString() === projectId);
    }

    public static async assertProjectAccess(companyId: string, managerId: string, projectId: string): Promise<void> {
        const allowed = await this.canAccessProject(companyId, managerId, projectId);
        if (!allowed) {
            throw AppError.forbidden('Forbidden: You do not have access to this project');
        }
    }

    public static async canAccessTask(companyId: string, managerId: string, taskId: string): Promise<boolean> {
        const scope = await this.resolveScope(companyId, managerId);
        if (scope.isCompanyAdmin) return true;
        if (scope.isSuspended) return false;

        const task = await Task.findOne({ _id: taskId, companyId }).select('projectId assignedToId createdBy').lean();
        if (!task) return false;

        // Accessible if project is accessible, or assignedTo is an accessible employee, or manager created it
        if (task.projectId && scope.allAccessibleProjectIds.some((id) => id.equals(task.projectId as any))) {
            return true;
        }
        if (task.assignedToId && scope.allAccessibleEmployeeIds.some((id) => id.equals(task.assignedToId as any))) {
            return true;
        }
        if (task.createdBy && String(task.createdBy) === managerId) {
            return true;
        }
        return false;
    }

    public static async assertTaskAccess(companyId: string, managerId: string, taskId: string): Promise<void> {
        const allowed = await this.canAccessTask(companyId, managerId, taskId);
        if (!allowed) {
            throw AppError.forbidden('Forbidden: You do not have access to this task');
        }
    }

    public static async hasPermission(
        companyId: string,
        managerId: string,
        permission: ManagerPermissionKey | string
    ): Promise<boolean> {
        const scope = await this.resolveScope(companyId, managerId);
        if (scope.isCompanyAdmin) return true;
        if (scope.isSuspended) return false;
        return scope.permissions.includes(permission);
    }

    public static async assertPermission(
        companyId: string,
        managerId: string,
        permission: ManagerPermissionKey | string
    ): Promise<void> {
        const allowed = await this.hasPermission(companyId, managerId, permission);
        if (!allowed) {
            throw AppError.forbidden(`Forbidden: Missing required manager permission: ${permission}`);
        }
    }

    public static async hasManagerAccess(companyId: string, managerId: string): Promise<boolean> {
        try {
            const scope = await this.resolveScope(companyId, managerId);
            if (scope.isCompanyAdmin) return true;
            if (scope.isSuspended) return false;
            return scope.permissions.length > 0;
        } catch {
            return false;
        }
    }
}
export default TeamAccessService;
