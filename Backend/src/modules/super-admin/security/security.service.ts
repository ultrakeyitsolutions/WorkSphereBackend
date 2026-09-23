import { Types } from 'mongoose';
import { AuthSession } from '../../auth/session/auth-session.model';
import { AuditLog } from '../../audit-logs/audit-log.model';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { User } from '../../users/user.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { SecuritySummaryData } from './security.types';

export class SuperAdminSecurityService {
    /**
     * Platform security metrics summary.
     */
    public static async getSummary(): Promise<SecuritySummaryData> {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const securityActions: AuditAction[] = [
            AuditAction.USER_LOGIN_FAILED,
            AuditAction.PASSWORD_RESET,
            AuditAction.PASSWORD_CHANGED,
            AuditAction.MFA_SETUP_INITIATED,
            AuditAction.MFA_ENABLED,
            AuditAction.MFA_DISABLED,
            AuditAction.MFA_VERIFY_FAILED,
            AuditAction.MFA_RECOVERY_USED,
            AuditAction.SESSION_REVOKED,
            AuditAction.ALL_SESSIONS_REVOKED,
            AuditAction.IMPERSONATION_STARTED,
            AuditAction.IMPERSONATION_ENDED,
            AuditAction.IMPERSONATION_EXPIRED,
        ];

        const [
            activeSessions,
            failed24h,
            failed7d,
            totalUsers,
            mfaUsers,
            events24h,
            events7d,
        ] = await Promise.all([
            AuthSession.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
            AuditLog.countDocuments({
                action: { $in: [AuditAction.USER_LOGIN_FAILED, AuditAction.MFA_VERIFY_FAILED] },
                createdAt: { $gte: oneDayAgo },
            }),
            AuditLog.countDocuments({
                action: { $in: [AuditAction.USER_LOGIN_FAILED, AuditAction.MFA_VERIFY_FAILED] },
                createdAt: { $gte: sevenDaysAgo },
            }),
            User.countDocuments({ status: { $ne: 'DEACTIVATED' } }),
            User.countDocuments({ mfaEnabled: true, status: { $ne: 'DEACTIVATED' } }),
            AuditLog.countDocuments({
                action: { $in: securityActions },
                createdAt: { $gte: oneDayAgo },
            }),
            AuditLog.countDocuments({
                action: { $in: securityActions },
                createdAt: { $gte: sevenDaysAgo },
            }),
        ]);

        const adoptionRate = totalUsers > 0 ? Math.round((mfaUsers / totalUsers) * 1000) / 10 : 0;

        return {
            activeSessions,
            failedLogins: {
                last24Hours: failed24h,
                last7Days: failed7d,
            },
            mfaAdoption: {
                totalUsers,
                mfaEnabledUsers: mfaUsers,
                adoptionRate,
            },
            securityEvents: {
                last24Hours: events24h,
                last7Days: events7d,
            },
        };
    }

    /**
     * List user authentication sessions with pagination.
     */
    public static async listSessions(
        pagination: PaginationParams,
        filters: { userId?: string; search?: string }
    ): Promise<PaginatedResult<any>> {
        const query: any = {};

        if (filters.userId && Types.ObjectId.isValid(filters.userId)) {
            query.userId = new Types.ObjectId(filters.userId);
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [sessions, total] = await Promise.all([
            AuthSession.find(query)
                .populate('userId', 'name email status role companyId')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            AuthSession.countDocuments(query),
        ]);

        const items = sessions.map((s: any) => ({
            id: s._id,
            user: s.userId
                ? {
                      id: s.userId._id,
                      name: s.userId.name,
                      email: s.userId.email,
                      status: s.userId.status,
                  }
                : null,
            deviceId: s.deviceId,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            lastUsedAt: s.lastUsedAt,
            expiresAt: s.expiresAt,
            mfaVerifiedAt: s.mfaVerifiedAt,
            isRevoked: !!s.revokedAt,
            revokedAt: s.revokedAt,
            createdAt: s.createdAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * List security events from AuditLog.
     */
    public static async listEvents(
        pagination: PaginationParams,
        filters: { action?: string; userId?: string; search?: string }
    ): Promise<PaginatedResult<any>> {
        const securityActions: AuditAction[] = [
            AuditAction.USER_LOGIN,
            AuditAction.USER_LOGIN_FAILED,
            AuditAction.USER_LOGOUT,
            AuditAction.PASSWORD_RESET,
            AuditAction.PASSWORD_CHANGED,
            AuditAction.MFA_SETUP_INITIATED,
            AuditAction.MFA_ENABLED,
            AuditAction.MFA_DISABLED,
            AuditAction.MFA_VERIFY_SUCCESS,
            AuditAction.MFA_VERIFY_FAILED,
            AuditAction.MFA_RECOVERY_USED,
            AuditAction.SESSION_REVOKED,
            AuditAction.ALL_SESSIONS_REVOKED,
            AuditAction.IMPERSONATION_STARTED,
            AuditAction.IMPERSONATION_ENDED,
            AuditAction.IMPERSONATION_EXPIRED,
        ];

        const query: any = {
            action: { $in: filters.action ? [filters.action] : securityActions },
        };

        if (filters.userId && Types.ObjectId.isValid(filters.userId)) {
            const uId = new Types.ObjectId(filters.userId);
            query.$or = [{ actorId: uId }, { targetUserId: uId }];
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.$or = [
                { actorEmail: regex },
                { targetEmail: regex },
                { description: regex },
                { ipAddress: regex },
            ];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [events, total] = await Promise.all([
            AuditLog.find(query)
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            AuditLog.countDocuments(query),
        ]);

        const items = events.map((e: any) => ({
            id: e._id,
            action: e.action,
            actorId: e.actorId,
            actorEmail: e.actorEmail,
            actorRole: e.actorRole,
            targetUserId: e.targetUserId,
            targetEmail: e.targetEmail,
            companyId: e.companyId,
            companyName: e.companyName,
            ipAddress: e.ipAddress,
            userAgent: e.userAgent,
            success: e.success,
            description: e.description,
            metadata: e.metadata,
            createdAt: e.createdAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }
}
