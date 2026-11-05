import { Server, Socket } from 'socket.io';
import { Types } from 'mongoose';
import Redis from 'ioredis';
import { getSocketServer } from '../../../sockets/socket-server';
import { FeatureAccessService, FeatureFlagKey } from './feature-access.service';
import { MONITORING_SOCKET_EVENTS } from '../live-monitoring/live-monitoring.types';
import { getRedisClient } from '../../../config/redis';
import { ModuleKey } from '../module-access/module-access.types';
import { VALID_MODULE_KEYS } from '../module-access/module-access.constants';

export const FEATURE_REVOCATION_REDIS_CHANNEL = 'worksphere:feature_revocation';

export const VALID_FEATURE_KEYS = new Set<FeatureFlagKey>([
    'enableLiveMonitoring',
    'enableDetailedMonitoring',
    'enableQuickMeetings',
    'enableChat',
    'enableAttendanceAdjustments',
    'enableTimesheets',
    'enableTaskAttachments',
    'enableEscalations',
    'enableManagerDashboard',
]);

export type RevocationType = 'COMPANY_FEATURES' | 'EMPLOYEE_MODULES' | 'EMPLOYEE_PERMISSIONS' | 'MANAGER_ACCESS';

export interface BaseRevocationEvent {
    type?: RevocationType;
    companyId: string;
    timestamp: number;
    version?: number;
}

export interface CompanyFeatureRevocationEvent extends BaseRevocationEvent {
    type?: 'COMPANY_FEATURES';
    disabledFeatures: FeatureFlagKey[];
    features?: Partial<Record<FeatureFlagKey, boolean>>;
}

export interface EmployeeModuleRevocationEvent extends BaseRevocationEvent {
    type: 'EMPLOYEE_MODULES';
    userIds?: string[];
    revokedModules: ModuleKey[];
    reason?: string;
}

export interface EmployeePermissionRevocationEvent extends BaseRevocationEvent {
    type: 'EMPLOYEE_PERMISSIONS';
    userIds: string[];
    revokedPermissions: string[];
    reason?: string;
}

export interface ManagerAccessRevocationEvent extends BaseRevocationEvent {
    type: 'MANAGER_ACCESS';
    managerId: string;
    revocationAction: 'REVOKE_TEAM' | 'REVOKE_EMPLOYEE' | 'REVOKE_PROJECT' | 'DEMOTE' | 'SUSPEND' | 'PERMISSIONS_UPDATED';
    targetId?: string;
    revokedPermissions?: string[];
    reason?: string;
}

export type FeatureRevocationPayload =
    | CompanyFeatureRevocationEvent
    | EmployeeModuleRevocationEvent
    | EmployeePermissionRevocationEvent
    | ManagerAccessRevocationEvent;

// Backward compatible type alias
export type FeatureRevocationEvent = FeatureRevocationPayload;

export class FeatureRevocationService {
    private static subscriberClient: Redis | null = null;
    private static isSubscribed = false;
    private static isInitializing = false;

    /**
     * Validates an incoming feature/module/permission revocation payload strictly.
     * Returns the validated object or null if malformed.
     */
    public static validateRevocationEvent(raw: any): FeatureRevocationPayload | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }

        const { companyId, timestamp } = raw;

        // 1. Validate companyId
        if (
            typeof companyId !== 'string' ||
            companyId.trim().length === 0 ||
            !Types.ObjectId.isValid(companyId)
        ) {
            return null;
        }

        // 2. Validate timestamp (finite number within reasonable time window)
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
            return null;
        }

        const now = Date.now();
        // Allow up to 2 minutes of future clock skew and up to 2 hours of past age
        if (timestamp > now + 120_000 || timestamp < now - 7_200_000) {
            return null;
        }

        const normalizedCompanyId = companyId.trim();

        // 3. Handle EMPLOYEE_MODULES
        if (raw.type === 'EMPLOYEE_MODULES') {
            if (!Array.isArray(raw.revokedModules) || raw.revokedModules.length === 0) {
                return null;
            }
            const validatedModules: ModuleKey[] = [];
            for (const mod of raw.revokedModules) {
                if (typeof mod === 'string' && VALID_MODULE_KEYS.includes(mod as ModuleKey)) {
                    validatedModules.push(mod as ModuleKey);
                }
            }
            if (validatedModules.length === 0) return null;

            const userIds = Array.isArray(raw.userIds)
                ? raw.userIds.filter((id: any) => typeof id === 'string' && Types.ObjectId.isValid(id))
                : undefined;

            return {
                type: 'EMPLOYEE_MODULES',
                companyId: normalizedCompanyId,
                userIds,
                revokedModules: Array.from(new Set(validatedModules)),
                timestamp,
                reason: raw.reason || 'REVOKED_BY_ADMIN',
            };
        }

        // 4. Handle EMPLOYEE_PERMISSIONS
        if (raw.type === 'EMPLOYEE_PERMISSIONS') {
            if (!Array.isArray(raw.revokedPermissions) || raw.revokedPermissions.length === 0) {
                return null;
            }
            if (!Array.isArray(raw.userIds) || raw.userIds.length === 0) {
                return null;
            }
            const validatedUserIds = raw.userIds.filter((id: any) => typeof id === 'string' && Types.ObjectId.isValid(id));
            if (validatedUserIds.length === 0) return null;

            return {
                type: 'EMPLOYEE_PERMISSIONS',
                companyId: normalizedCompanyId,
                userIds: validatedUserIds,
                revokedPermissions: Array.from(new Set(raw.revokedPermissions.map(String))),
                timestamp,
                reason: raw.reason || 'REVOKED_BY_ADMIN',
            };
        }

        // 5. Handle MANAGER_ACCESS
        if (raw.type === 'MANAGER_ACCESS') {
            if (!raw.managerId || typeof raw.managerId !== 'string' || !Types.ObjectId.isValid(raw.managerId)) {
                return null;
            }
            return {
                type: 'MANAGER_ACCESS',
                companyId: normalizedCompanyId,
                managerId: raw.managerId.trim(),
                revocationAction: raw.revocationAction || 'PERMISSIONS_UPDATED',
                targetId: raw.targetId ? String(raw.targetId).trim() : undefined,
                revokedPermissions: Array.isArray(raw.revokedPermissions) ? raw.revokedPermissions.map(String) : undefined,
                reason: raw.reason || 'REVOKED_BY_ADMIN',
                timestamp,
            };
        }

        // 6. Default/Legacy: COMPANY_FEATURES
        const { disabledFeatures, features } = raw;
        const hasFeatureSnapshot =
            features && typeof features === 'object' && !Array.isArray(features);

        if (
            (!Array.isArray(disabledFeatures) || disabledFeatures.length === 0) &&
            !hasFeatureSnapshot
        ) {
            return null;
        }

        const validatedKeys: FeatureFlagKey[] = [];
        if (Array.isArray(disabledFeatures)) {
            for (const key of disabledFeatures) {
                if (typeof key === 'string' && VALID_FEATURE_KEYS.has(key as FeatureFlagKey)) {
                    validatedKeys.push(key as FeatureFlagKey);
                } else {
                    return null;
                }
            }
        }

        let validatedFeatures: Partial<Record<FeatureFlagKey, boolean>> | undefined;
        if (hasFeatureSnapshot) {
            validatedFeatures = {};
            for (const [key, value] of Object.entries(features)) {
                if (!VALID_FEATURE_KEYS.has(key as FeatureFlagKey) || typeof value !== 'boolean') {
                    return null;
                }
                validatedFeatures[key as FeatureFlagKey] = value;
            }
        }

        return {
            type: 'COMPANY_FEATURES',
            companyId: normalizedCompanyId,
            disabledFeatures: Array.from(new Set(validatedKeys)),
            features: validatedFeatures,
            timestamp,
        };
    }

    /**
     * Broadcasts a company-wide feature revocation event across workers and evicts local sockets immediately.
     */
    public static async revokeCompanyFeatures(
        companyId: string,
        disabledFeatures: FeatureFlagKey[]
    ): Promise<{ localEvicted: boolean; publishedToRedis: boolean }> {
        if (!companyId || !disabledFeatures || disabledFeatures.length === 0) {
            return { localEvicted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();
        const validFeatures = disabledFeatures.filter((f) => VALID_FEATURE_KEYS.has(f));

        if (validFeatures.length === 0) {
            return { localEvicted: false, publishedToRedis: false };
        }

        // 1. Invalidate local in-memory feature cache immediately on this process
        FeatureAccessService.invalidateCache(normalizedCompanyId);
        await this.invalidateCompanyModuleAccessCache(normalizedCompanyId);

        // 2. Perform immediate local socket eviction and broadcast
        this.evictLocalSockets(normalizedCompanyId, validFeatures);

        // 3. Publish to Redis Pub/Sub with bounded retry for cross-worker delivery
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const eventPayload: CompanyFeatureRevocationEvent = {
                    type: 'COMPANY_FEATURES',
                    companyId: normalizedCompanyId,
                    disabledFeatures: validFeatures,
                    timestamp: Date.now(),
                };

                const serialized = JSON.stringify(eventPayload);

                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        await redis.publish(FEATURE_REVOCATION_REDIS_CHANNEL, serialized);
                        publishedToRedis = true;
                        break;
                    } catch (publishErr: any) {
                        if (attempt === 2) {
                            console.warn(
                                `[FeatureRevocationService] Redis publish attempt ${attempt} failed: ${publishErr?.message}`
                            );
                        } else {
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                }
            }
        } catch (err: any) {
            console.warn(
                `[FeatureRevocationService] Cross-worker publication error: ${err?.message}`
            );
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Broadcasts the latest company feature snapshot across workers so caches and clients
     * converge immediately when features are re-enabled (not only when revoked).
     */
    public static async notifyCompanyFeaturesUpdated(
        companyId: string,
        features: Partial<Record<FeatureFlagKey, boolean>>
    ): Promise<{ localEvicted: boolean; publishedToRedis: boolean }> {
        if (!companyId || !features || typeof features !== 'object') {
            return { localEvicted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();
        const snapshot: Partial<Record<FeatureFlagKey, boolean>> = {};

        for (const [key, value] of Object.entries(features)) {
            if (VALID_FEATURE_KEYS.has(key as FeatureFlagKey) && typeof value === 'boolean') {
                snapshot[key as FeatureFlagKey] = value;
            }
        }

        const disabledFeatures = (Object.entries(snapshot) as [FeatureFlagKey, boolean][])
            .filter(([, enabled]) => enabled === false)
            .map(([key]) => key);

        FeatureAccessService.invalidateCache(normalizedCompanyId);
        await this.invalidateCompanyModuleAccessCache(normalizedCompanyId);
        this.evictLocalSockets(normalizedCompanyId, disabledFeatures, snapshot);

        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const eventPayload: CompanyFeatureRevocationEvent = {
                    type: 'COMPANY_FEATURES',
                    companyId: normalizedCompanyId,
                    disabledFeatures,
                    features: snapshot,
                    timestamp: Date.now(),
                };

                const serialized = JSON.stringify(eventPayload);

                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        await redis.publish(FEATURE_REVOCATION_REDIS_CHANNEL, serialized);
                        publishedToRedis = true;
                        break;
                    } catch (publishErr: any) {
                        if (attempt === 2) {
                            console.warn(
                                `[FeatureRevocationService] Redis publish attempt ${attempt} failed: ${publishErr?.message}`
                            );
                        } else {
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                }
            }
        } catch (err: any) {
            console.warn(
                `[FeatureRevocationService] Cross-worker feature update publication error: ${err?.message}`
            );
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Broadcasts an employee module access revocation event across workers and evicts local sockets immediately.
     */
    public static async revokeEmployeeModules(
        companyId: string,
        userIds?: string[],
        revokedModules?: ModuleKey[]
    ): Promise<{ localEvicted: boolean; publishedToRedis: boolean }> {
        if (!companyId) {
            return { localEvicted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();
        const validModules = (revokedModules || []).filter((m) => VALID_MODULE_KEYS.includes(m));

        if (validModules.length === 0) {
            return { localEvicted: false, publishedToRedis: false };
        }

        // 1. Invalidate Redis cache for affected users
        try {
            const redis = getRedisClient();
            if (redis) {
                if (userIds && userIds.length > 0) {
                    const keys = [
                        `worksphere:cache:module_access:${normalizedCompanyId}:global`,
                        ...userIds.map((u) => `worksphere:cache:module_access:${normalizedCompanyId}:${u}`),
                    ];
                    await redis.del(...keys).catch(() => {});
                } else {
                    const pattern = `worksphere:cache:module_access:${normalizedCompanyId}:*`;
                    const keys = await redis.keys(pattern).catch(() => []);
                    if (keys.length > 0) {
                        await redis.del(...keys).catch(() => {});
                    }
                }
            }
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Redis cache invalidation error:', err?.message);
        }

        // 2. Perform immediate local socket eviction and broadcast
        this.evictLocalEmployeeSockets(normalizedCompanyId, userIds, validModules);

        // 3. Publish to Redis Pub/Sub for cross-worker propagation
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const eventPayload: EmployeeModuleRevocationEvent = {
                    type: 'EMPLOYEE_MODULES',
                    companyId: normalizedCompanyId,
                    userIds: userIds && userIds.length > 0 ? userIds : undefined,
                    revokedModules: validModules,
                    timestamp: Date.now(),
                    reason: 'REVOKED_BY_ADMIN',
                };

                const serialized = JSON.stringify(eventPayload);
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        await redis.publish(FEATURE_REVOCATION_REDIS_CHANNEL, serialized);
                        publishedToRedis = true;
                        break;
                    } catch (publishErr: any) {
                        if (attempt === 2) {
                            console.warn(`[FeatureRevocationService] Redis publish attempt ${attempt} failed: ${publishErr?.message}`);
                        } else {
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                }
            }
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Cross-worker module revocation publish error:', err?.message);
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Broadcasts fine-grained employee permission revocation across workers and evicts local sockets immediately.
     */
    public static async revokeEmployeePermissions(
        companyId: string,
        userIds: string[],
        revokedPermissions: string[]
    ): Promise<{ localEvicted: boolean; publishedToRedis: boolean }> {
        if (!companyId || !userIds || userIds.length === 0 || !revokedPermissions || revokedPermissions.length === 0) {
            return { localEvicted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();

        // 1. Invalidate permission cache
        try {
            const redis = getRedisClient();
            if (redis) {
                const keys = userIds.map((u) => `worksphere:cache:permissions:${u}`);
                await redis.del(...keys).catch(() => {});
            }
        } catch {}

        // 2. Local socket broadcast
        const io = getSocketServer();
        if (io) {
            userIds.forEach((uId) => {
                io.to(`user:${uId}`).emit('feature:revocation', {
                    type: 'EMPLOYEE_PERMISSIONS',
                    companyId: normalizedCompanyId,
                    userId: uId,
                    revokedPermissions,
                    timestamp: Date.now(),
                    message: 'Your permissions have been updated by your administrator.',
                });
                io.to(`user:${uId}`).emit('user:permissions_updated', {
                    companyId: normalizedCompanyId,
                    userId: uId,
                    revokedPermissions,
                    timestamp: Date.now(),
                });
            });
        }

        // 3. Publish to Redis Pub/Sub
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const payload: EmployeePermissionRevocationEvent = {
                    type: 'EMPLOYEE_PERMISSIONS',
                    companyId: normalizedCompanyId,
                    userIds,
                    revokedPermissions,
                    timestamp: Date.now(),
                    reason: 'REVOKED_BY_ADMIN',
                };
                await redis.publish(FEATURE_REVOCATION_REDIS_CHANNEL, JSON.stringify(payload));
                publishedToRedis = true;
            }
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Cross-worker permission revocation publish error:', err?.message);
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Broadcasts manager access/scope revocation across workers, invalidates scope cache, and evicts manager sockets.
     */
    public static async revokeManagerAccess(
        companyId: string,
        managerId: string,
        revocationAction: 'REVOKE_TEAM' | 'REVOKE_EMPLOYEE' | 'REVOKE_PROJECT' | 'DEMOTE' | 'SUSPEND' | 'PERMISSIONS_UPDATED',
        targetId?: string,
        revokedPermissions?: string[],
        reason?: string
    ): Promise<{ localEvicted: boolean; publishedToRedis: boolean }> {
        if (!companyId || !managerId) {
            return { localEvicted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();
        const normalizedManagerId = String(managerId).trim();

        // 1. Invalidate manager scope cache immediately
        try {
            const { TeamAccessService } = await import('../../manager/services/team-access.service.js');
            await TeamAccessService.invalidateScopeCache(normalizedCompanyId, normalizedManagerId);
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Error invalidating manager scope cache:', err?.message);
        }

        // 2. Perform immediate local socket eviction
        this.evictLocalManagerSockets(
            normalizedCompanyId,
            normalizedManagerId,
            revocationAction,
            targetId,
            revokedPermissions,
            reason
        );

        // 3. Publish to Redis Pub/Sub for cross-worker delivery
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const payload: ManagerAccessRevocationEvent = {
                    type: 'MANAGER_ACCESS',
                    companyId: normalizedCompanyId,
                    managerId: normalizedManagerId,
                    revocationAction,
                    targetId,
                    revokedPermissions,
                    timestamp: Date.now(),
                    reason: reason || 'REVOKED_BY_ADMIN',
                };
                await redis.publish(FEATURE_REVOCATION_REDIS_CHANNEL, JSON.stringify(payload));
                publishedToRedis = true;
            }
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Cross-worker manager revocation publish error:', err?.message);
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Clears cached effective module access for every member of a company so feature
     * changes are reflected immediately instead of waiting for the 60s Redis TTL.
     */
    private static async invalidateCompanyModuleAccessCache(companyId: string): Promise<void> {
        try {
            const redis = getRedisClient();
            if (!redis || typeof redis.keys !== 'function') return;

            const pattern = `worksphere:cache:module_access:${companyId}:*`;
            const keys = await redis.keys(pattern).catch(() => []);
            if (keys.length > 0) {
                await redis.del(...keys).catch(() => {});
            }
        } catch {
            // Cache invalidation failures must never block revocation delivery
        }
    }

    /**
     * Evicts connected sockets belonging to the target company from protected company-level feature rooms.
     */
    public static evictLocalSockets(
        companyId: string,
        disabledFeatures: FeatureFlagKey[],
        features?: Partial<Record<FeatureFlagKey, boolean>>
    ): void {
        const io = getSocketServer();
        if (!io) return;

        const normalizedCompanyId = String(companyId).trim();
        const socketsMap = io.sockets.sockets;

        for (const [, socket] of socketsMap) {
            const user = (socket as Socket).data?.user;
            if (!user) continue;

            const socketCompanyId = String(user.companyId || '').trim();
            if (socketCompanyId !== normalizedCompanyId) continue;

            // ── A. Live & Detailed Monitoring Revocation ───────────────────────
            if (
                disabledFeatures.includes('enableLiveMonitoring') ||
                disabledFeatures.includes('enableDetailedMonitoring')
            ) {
                let wasInMonitoring = false;
                const roomsToLeave: string[] = [];

                for (const room of socket.rooms) {
                    if (
                        room === `company:${normalizedCompanyId}:monitoring` ||
                        room.startsWith(`company:${normalizedCompanyId}:employee:`)
                    ) {
                        roomsToLeave.push(room);
                        wasInMonitoring = true;
                    }
                }

                for (const room of roomsToLeave) {
                    socket.leave(room);
                }

                if (wasInMonitoring) {
                    socket.emit(MONITORING_SOCKET_EVENTS.ERROR, {
                        code: 'FEATURE_DISABLED_BY_COMPANY',
                        message: 'Live monitoring has been disabled for your organization.',
                    });
                    socket.emit(MONITORING_SOCKET_EVENTS.SYNC_REQUIRED, {
                        reason: 'FEATURE_DISABLED',
                        message: 'Live monitoring has been disabled by company settings.',
                    });
                }
            }

            // ── B. Team Chat Revocation ──────────────────────────────────────
            if (disabledFeatures.includes('enableChat')) {
                let wasInChat = false;
                const chatRoomsToLeave: string[] = [];

                for (const room of socket.rooms) {
                    if (room.startsWith('conversation:')) {
                        chatRoomsToLeave.push(room);
                        wasInChat = true;
                    }
                }

                for (const room of chatRoomsToLeave) {
                    socket.leave(room);
                }

                if (wasInChat) {
                    socket.emit('chat:feature_disabled', {
                        code: 'FEATURE_DISABLED_BY_COMPANY',
                        message: 'Team chat has been disabled for your organization.',
                    });
                }
            }

            // ── C. Manager Dashboard Revocation ──────────────────────────────
            if (disabledFeatures.includes('enableManagerDashboard')) {
                const managerRoomsToLeave: string[] = [];
                for (const room of socket.rooms) {
                    if (room.startsWith('manager:')) {
                        managerRoomsToLeave.push(room);
                    }
                }
                for (const room of managerRoomsToLeave) {
                    socket.leave(room);
                }

                socket.emit('manager:feature_disabled', {
                    code: 'FEATURE_DISABLED',
                    message: 'Manager Dashboard is currently disabled by your organization administrator.',
                });
                socket.emit('manager:access:revoked', {
                    action: 'SUSPEND',
                    reason: 'Manager Dashboard is currently disabled by your organization administrator.',
                    companyId: normalizedCompanyId,
                    timestamp: Date.now(),
                });
                socket.emit('manager:access_revoked', {
                    action: 'SUSPEND',
                    reason: 'Manager Dashboard is currently disabled by your organization administrator.',
                    companyId: normalizedCompanyId,
                    timestamp: Date.now(),
                });
            }

            // ── C. Deliver structured feature:revocation event ────────────────
            if (disabledFeatures.length > 0) {
                socket.emit('feature:revocation', {
                    type: 'COMPANY_FEATURES',
                    companyId: normalizedCompanyId,
                    disabledFeatures,
                    features,
                    timestamp: Date.now(),
                    message: 'One or more organization features have been disabled by administrator.',
                });
            }
        }

        // Notify company room
        io.to(`company:${normalizedCompanyId}`).emit('company:features_updated', {
            companyId: normalizedCompanyId,
            disabledFeatures,
            features,
            timestamp: Date.now(),
        });
    }

    /**
     * Evicts connected sockets of specific employees from revoked module rooms and delivers real-time revocation events.
     */
    public static evictLocalEmployeeSockets(
        companyId: string,
        userIds: string[] | undefined,
        revokedModules: ModuleKey[]
    ): void {
        const io = getSocketServer();
        if (!io) return;

        const normalizedCompanyId = String(companyId).trim();
        const targetUserIdSet = userIds && userIds.length > 0 ? new Set(userIds.map(String)) : null;
        const socketsMap = io.sockets.sockets;

        for (const [, socket] of socketsMap) {
            const user = (socket as Socket).data?.user;
            if (!user) continue;

            const socketCompanyId = String(user.companyId || '').trim();
            if (socketCompanyId !== normalizedCompanyId) continue;

            const socketUserId = String(user.userId || user.id || '').trim();
            if (targetUserIdSet && !targetUserIdSet.has(socketUserId)) {
                continue;
            }

            // ── Room Eviction for Chat ─────────────────────────────────────────
            if (revokedModules.includes('chat')) {
                for (const room of Array.from(socket.rooms)) {
                    if (room.startsWith('conversation:')) {
                        socket.leave(room);
                    }
                }
                socket.emit('chat:feature_disabled', {
                    code: 'MODULE_ACCESS_RESTRICTED',
                    message: 'Access to Chat has been restricted by your administrator.',
                });
            }

            // ── Room Eviction for Meetings ─────────────────────────────────────
            if (revokedModules.includes('meetings')) {
                for (const room of Array.from(socket.rooms)) {
                    if (room.startsWith('meeting:')) {
                        socket.leave(room);
                    }
                }
                socket.emit('meeting:access_revoked', {
                    code: 'MODULE_ACCESS_RESTRICTED',
                    message: 'Access to Meetings has been restricted by your administrator.',
                });
            }

            // ── Room Eviction for Monitoring ──────────────────────────────────
            if (revokedModules.includes('live-monitoring') || revokedModules.includes('detailed-monitoring')) {
                for (const room of Array.from(socket.rooms)) {
                    if (
                        room === `company:${normalizedCompanyId}:monitoring` ||
                        room.startsWith(`company:${normalizedCompanyId}:employee:`)
                    ) {
                        socket.leave(room);
                    }
                }
            }

            // Deliver authoritative immediate revocation event
            socket.emit('feature:revocation', {
                type: 'EMPLOYEE_MODULES',
                companyId: normalizedCompanyId,
                userId: socketUserId,
                revokedModules,
                timestamp: Date.now(),
                message: `Access to ${revokedModules.join(', ')} has been revoked by your administrator.`,
            });

            socket.emit('member:module_access_updated', {
                companyId: normalizedCompanyId,
                userId: socketUserId,
                revokedModules,
                timestamp: Date.now(),
            });
        }

        // Notify company channel
        io.to(`company:${normalizedCompanyId}`).emit('company:module_access_updated', {
            companyId: normalizedCompanyId,
            affectedUserIds: userIds || [],
            revokedModules,
            timestamp: Date.now(),
        });
    }

    /**
     * Evicts connected sockets of a manager upon assignment revocation, demotion, or permission change.
     */
    public static evictLocalManagerSockets(
        companyId: string,
        managerId: string,
        revocationAction: 'REVOKE_TEAM' | 'REVOKE_EMPLOYEE' | 'REVOKE_PROJECT' | 'DEMOTE' | 'SUSPEND' | 'PERMISSIONS_UPDATED',
        targetId?: string,
        revokedPermissions?: string[],
        reason?: string
    ): void {
        const io = getSocketServer();
        if (!io) return;

        const normalizedCompanyId = String(companyId).trim();
        const normalizedManagerId = String(managerId).trim();

        for (const [, socket] of io.sockets.sockets) {
            const user = socket.data?.user;
            if (!user) continue;

            const socketUserId = String(user.userId || user.id || '').trim();
            const socketCompanyId = String(user.companyId || '').trim();

            if (socketUserId !== normalizedManagerId || socketCompanyId !== normalizedCompanyId) {
                continue;
            }

            // If a specific team was revoked, leave that team room
            if (revocationAction === 'REVOKE_TEAM' && targetId) {
                socket.leave(`manager:team:${targetId}`);
            }

            // If demoted or suspended, leave all manager rooms
            if (revocationAction === 'DEMOTE' || revocationAction === 'SUSPEND') {
                for (const room of Array.from(socket.rooms || [])) {
                    if (room.startsWith('manager:')) {
                        socket.leave(room);
                    }
                }
            }

            // Emit instant revocation event directly to the manager's socket
            socket.emit('manager:access_revoked', {
                companyId: normalizedCompanyId,
                managerId: normalizedManagerId,
                action: revocationAction,
                targetId,
                revokedPermissions,
                reason: reason || 'Access modified by administrator',
                timestamp: Date.now(),
            });

            if (revocationAction === 'DEMOTE') {
                socket.emit('manager:demoted', {
                    companyId: normalizedCompanyId,
                    managerId: normalizedManagerId,
                    reason,
                    timestamp: Date.now(),
                });
            }
        }
    }

    /**
     * Initialize cross-worker Redis subscriber if Redis client is available.
     * Prevents duplicate subscriptions and handles connection lifecycle safely.
     */
    public static async initCrossWorkerSubscriber(_io?: Server): Promise<boolean> {
        if (this.isSubscribed || this.isInitializing) {
            return this.isSubscribed;
        }

        this.isInitializing = true;

        try {
            const redis = getRedisClient();
            if (!redis) {
                this.isInitializing = false;
                return false;
            }

            const subscriber = redis.duplicate({
                lazyConnect: true,
                maxRetriesPerRequest: null,
            });

            subscriber.on('error', (err) => {
                console.warn('[FeatureRevocationService] Redis subscriber connection error:', err?.message);
            });

            subscriber.on('connect', () => {
                console.info('[FeatureRevocationService] Redis subscriber connected successfully.');
            });

            subscriber.on('reconnecting', (delay: number) => {
                console.warn(`[FeatureRevocationService] Redis subscriber reconnecting in ${delay}ms...`);
            });

            subscriber.on('ready', () => {
                console.info('[FeatureRevocationService] Redis subscriber ready. Purging stale local cache entries.');
                FeatureAccessService.clearAllCache();
            });

            subscriber.on('message', async (channel: string, message: string) => {
                if (channel === FEATURE_REVOCATION_REDIS_CHANNEL) {
                    try {
                        const parsed = JSON.parse(message);
                        const validated = FeatureRevocationService.validateRevocationEvent(parsed);

                        if (!validated) {
                            console.warn('[FeatureRevocationService] Dropped malformed feature revocation event.');
                            return;
                        }

                        // Apply appropriate invalidation and local eviction on this worker
                        if (validated.type === 'EMPLOYEE_MODULES') {
                            FeatureRevocationService.evictLocalEmployeeSockets(
                                validated.companyId,
                                validated.userIds,
                                validated.revokedModules
                            );
                        } else if (validated.type === 'EMPLOYEE_PERMISSIONS') {
                            const io = getSocketServer();
                            if (io) {
                                validated.userIds.forEach((uId) => {
                                    io.to(`user:${uId}`).emit('feature:revocation', {
                                        type: 'EMPLOYEE_PERMISSIONS',
                                        companyId: validated.companyId,
                                        userId: uId,
                                        revokedPermissions: validated.revokedPermissions,
                                        timestamp: validated.timestamp,
                                    });
                                    io.to(`user:${uId}`).emit('user:permissions_updated', {
                                        companyId: validated.companyId,
                                        userId: uId,
                                        revokedPermissions: validated.revokedPermissions,
                                        timestamp: validated.timestamp,
                                    });
                                });
                            }
                        } else if (validated.type === 'MANAGER_ACCESS') {
                            const managerEvent = validated as ManagerAccessRevocationEvent;
                            try {
                                const { TeamAccessService } = await import('../../manager/services/team-access.service.js');
                                await TeamAccessService.invalidateScopeCache(managerEvent.companyId, managerEvent.managerId);
                            } catch {}

                            FeatureRevocationService.evictLocalManagerSockets(
                                managerEvent.companyId,
                                managerEvent.managerId,
                                managerEvent.revocationAction,
                                managerEvent.targetId,
                                managerEvent.revokedPermissions,
                                managerEvent.reason
                            );
                        } else {
                            // COMPANY_FEATURES
                            const companyFeatureEvent = validated as CompanyFeatureRevocationEvent;
                            FeatureAccessService.invalidateCache(validated.companyId);
                            FeatureRevocationService.evictLocalSockets(
                                validated.companyId,
                                companyFeatureEvent.disabledFeatures,
                                companyFeatureEvent.features
                            );
                        }
                    } catch (parseErr: any) {
                        console.error('[FeatureRevocationService] Failed to parse Redis message payload:', parseErr?.message);
                    }
                }
            });

            if (subscriber.status === 'wait') {
                await subscriber.connect().catch((connErr) => {
                    console.warn('[FeatureRevocationService] Lazy connect failed for subscriber:', connErr?.message);
                });
            }

            await subscriber.subscribe(FEATURE_REVOCATION_REDIS_CHANNEL);

            this.subscriberClient = subscriber;
            this.isSubscribed = true;
            this.isInitializing = false;
            console.info('[FeatureRevocationService] Successfully subscribed to Redis feature revocation channel.');
            return true;
        } catch (err: any) {
            console.warn('[FeatureRevocationService] Could not establish Redis feature subscriber:', err?.message);
            this.isSubscribed = false;
            this.isInitializing = false;
            return false;
        }
    }

    /**
     * Gracefully shutdown the Redis subscriber connection.
     */
    public static async shutdown(): Promise<void> {
        if (this.subscriberClient) {
            try {
                await this.subscriberClient.unsubscribe(FEATURE_REVOCATION_REDIS_CHANNEL).catch(() => {});
                await this.subscriberClient.quit().catch(() => {
                    this.subscriberClient?.disconnect();
                });
            } catch {}
            this.subscriberClient = null;
        }
        this.isSubscribed = false;
        this.isInitializing = false;
    }

    /**
     * Test inspection helper to check subscription status.
     */
    public static getSubscriptionStatus(): { isSubscribed: boolean; isInitializing: boolean } {
        return {
            isSubscribed: this.isSubscribed,
            isInitializing: this.isInitializing,
        };
    }
}
export default FeatureRevocationService;
