import { Types } from 'mongoose';
import { User } from '../../users/user.model';
import { Project, ProjectTeamMember } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { AuditLog } from '../../audit-logs/audit-log.model';
import { AuthSession } from '../../auth/session/auth-session.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { UserStatisticsData, UserEffectivePermissionsData } from './users.types';
import { AppError } from '../../../utils/AppError';

export class SuperAdminUsersService {
    /**
     * List all platform users with pagination and filtering.
     */
    public static async listUsers(
        pagination: PaginationParams,
        filters: { search?: string; companyId?: string; role?: string; status?: string }
    ): Promise<PaginatedResult<any>> {
        const query: any = { status: { $ne: 'DEACTIVATED' } };

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        if (filters.companyId && Types.ObjectId.isValid(filters.companyId)) {
            query.companyId = new Types.ObjectId(filters.companyId);
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.$or = [{ name: regex }, { email: regex }];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password -grantedPermissions -revokedPermissions')
                .populate('role', 'name')
                .populate('companyId', 'name slug domain status')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            User.countDocuments(query),
        ]);

        let items = users.map((u: any) => ({
            id: u._id,
            name: u.name,
            email: u.email,
            role: u.role ? (typeof u.role === 'object' ? u.role.name : u.role) : 'MEMBER',
            company: u.companyId
                ? {
                      id: u.companyId._id,
                      name: u.companyId.name,
                      slug: u.companyId.slug,
                      status: u.companyId.status,
                  }
                : null,
            status: u.status,
            isActive: u.isActive,
            mfaEnabled: u.mfaEnabled,
            mustChangePassword: u.mustChangePassword,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
        }));

        if (filters.role) {
            items = items.filter((u) => u.role.toLowerCase() === filters.role?.toLowerCase());
        }

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get single user profile details safely.
     */
    public static async getUserDetails(userId: string) {
        if (!Types.ObjectId.isValid(userId)) {
            throw AppError.badRequest('Invalid user ID');
        }

        const user = await User.findById(userId)
            .select('-password')
            .populate('role', 'name')
            .populate('companyId', 'name slug domain status')
            .lean();

        if (!user) {
            throw AppError.notFound('User not found');
        }

        // Fetch last active session or last activity
        const lastSession = await AuthSession.findOne({ userId: new Types.ObjectId(userId) })
            .sort({ lastUsedAt: -1 })
            .lean();

        return {
            id: user._id,
            name: user.name,
            email: user.email,
            role: (user.role as any)?.name || 'MEMBER',
            company: user.companyId
                ? {
                      id: (user.companyId as any)._id,
                      name: (user.companyId as any).name,
                      slug: (user.companyId as any).slug,
                      status: (user.companyId as any).status,
                  }
                : null,
            status: user.status,
            isActive: user.isActive,
            mfaEnabled: user.mfaEnabled,
            mustChangePassword: user.mustChangePassword,
            lastActive: lastSession?.lastUsedAt || user.updatedAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }

    /**
     * Get user statistics across platform.
     */
    public static async getUserStatistics(userId: string): Promise<UserStatisticsData> {
        if (!Types.ObjectId.isValid(userId)) {
            throw AppError.badRequest('Invalid user ID');
        }

        const uId = new Types.ObjectId(userId);

        const [
            createdProjects,
            assignedProjects,
            totalTasks,
            completedTasks,
            inProgressTasks,
            timeTrackingAgg,
            attendanceCount,
            activeCheckIn,
        ] = await Promise.all([
            Project.countDocuments({ createdById: uId, deletedAt: null }),
            ProjectTeamMember.countDocuments({ userId: uId }),
            Task.countDocuments({ assignedToId: uId }),
            Task.countDocuments({ assignedToId: uId, progress: 100 }),
            Task.countDocuments({ assignedToId: uId, progress: { $gt: 0, $lt: 100 } }),
            TimeTracking.aggregate([
                { $match: { userId: uId } },
                { $group: { _id: null, totalSeconds: { $sum: '$workedSeconds' } } },
            ]),
            Attendance.countDocuments({ userId: uId }),
            Attendance.findOne({ userId: uId, status: AttendanceStatus.CHECKED_IN }),
        ]);

        const totalWorkedHours = timeTrackingAgg.length > 0
            ? Math.round((timeTrackingAgg[0].totalSeconds / 3600) * 10) / 10
            : 0;

        return {
            userId,
            projects: {
                total: createdProjects + assignedProjects,
                created: createdProjects,
                assigned: assignedProjects,
            },
            tasks: {
                total: totalTasks,
                completed: completedTasks,
                inProgress: inProgressTasks,
            },
            timesheet: {
                totalWorkedHours,
            },
            attendance: {
                totalRecords: attendanceCount,
                checkedIn: !!activeCheckIn,
            },
        };
    }

    /**
     * Get user activity feed from AuditLog.
     */
    public static async getUserActivity(
        userId: string,
        pagination: PaginationParams
    ): Promise<PaginatedResult<any>> {
        if (!Types.ObjectId.isValid(userId)) {
            throw AppError.badRequest('Invalid user ID');
        }

        const uId = new Types.ObjectId(userId);
        const query = {
            $or: [{ actorId: uId }, { targetUserId: uId }],
        };

        const [logs, total] = await Promise.all([
            AuditLog.find(query)
                .sort({ createdAt: -1 })
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            AuditLog.countDocuments(query),
        ]);

        const items = logs.map((log: any) => ({
            id: log._id,
            action: log.action,
            actorId: log.actorId,
            actorEmail: log.actorEmail,
            actorRole: log.actorRole,
            targetUserId: log.targetUserId,
            targetEmail: log.targetEmail,
            companyId: log.companyId,
            companyName: log.companyName,
            metadata: log.metadata,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            success: log.success,
            description: log.description,
            createdAt: log.createdAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get effective permissions for a user.
     */
    public static async getUserPermissions(userId: string): Promise<UserEffectivePermissionsData> {
        if (!Types.ObjectId.isValid(userId)) {
            throw AppError.badRequest('Invalid user ID');
        }

        const user = await User.findById(userId)
            .populate({
                path: 'role',
                populate: { path: 'permissions', select: 'name' },
            })
            .populate('grantedPermissions', 'name')
            .populate('revokedPermissions', 'name')
            .lean();

        if (!user) {
            throw AppError.notFound('User not found');
        }

        const role = user.role as any;
        const roleName = role?.name || 'MEMBER';

        const baseRolePermissions: string[] = (role?.permissions || [])
            .map((p: any) => (typeof p === 'object' && p ? p.name : p))
            .filter(Boolean);

        const grantedPermissions: string[] = ((user as any).grantedPermissions || [])
            .map((p: any) => (typeof p === 'object' && p ? p.name : p))
            .filter(Boolean);

        const revokedPermissions: string[] = ((user as any).revokedPermissions || [])
            .map((p: any) => (typeof p === 'object' && p ? p.name : p))
            .filter(Boolean);

        const effectiveSet = new Set(baseRolePermissions);
        grantedPermissions.forEach((p) => effectiveSet.add(p));
        revokedPermissions.forEach((p) => effectiveSet.delete(p));

        return {
            userId,
            roleName,
            baseRolePermissions,
            grantedPermissions,
            revokedPermissions,
            effectivePermissions: Array.from(effectiveSet),
        };
    }
}
