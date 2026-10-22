import { Server, Socket } from 'socket.io';
import { Types } from 'mongoose';
import Redis from 'ioredis';
import { getSocketServer } from '../../../sockets/socket-server';
import { FeatureAccessService, FeatureFlagKey } from './feature-access.service';
import { MONITORING_SOCKET_EVENTS } from '../live-monitoring/live-monitoring.types';
import { getRedisClient } from '../../../config/redis';

export const FEATURE_REVOCATION_REDIS_CHANNEL = 'worksphere:feature_revocation';

export const VALID_FEATURE_KEYS = new Set<FeatureFlagKey>([
    'enableLiveMonitoring',
    'enableDetailedMonitoring',
    'enableQuickMeetings',
    'enableChat',
    'enableAttendanceAdjustments',
    'enableTimesheets',
    'enableTaskAttachments',
]);

export interface FeatureRevocationEvent {
    companyId: string;
    disabledFeatures: FeatureFlagKey[];
    timestamp: number;
}

export class FeatureRevocationService {
    private static subscriberClient: Redis | null = null;
    private static isSubscribed = false;
    private static isInitializing = false;

    /**
     * Validates an incoming feature revocation payload strictly.
     * Returns the validated object or null if malformed.
     */
    public static validateRevocationEvent(raw: any): FeatureRevocationEvent | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }

        const { companyId, disabledFeatures, timestamp } = raw;

        // 1. Validate companyId (must be valid ObjectId format or non-empty string)
        if (
            typeof companyId !== 'string' ||
            companyId.trim().length === 0 ||
            !Types.ObjectId.isValid(companyId)
        ) {
            return null;
        }

        // 2. Validate disabledFeatures array
        if (!Array.isArray(disabledFeatures) || disabledFeatures.length === 0) {
            return null;
        }

        const validatedKeys: FeatureFlagKey[] = [];
        for (const key of disabledFeatures) {
            if (typeof key === 'string' && VALID_FEATURE_KEYS.has(key as FeatureFlagKey)) {
                validatedKeys.push(key as FeatureFlagKey);
            } else {
                // Unknown or invalid feature key encountered
                return null;
            }
        }

        // 3. Validate timestamp (finite number within reasonable time window)
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
            return null;
        }

        const now = Date.now();
        // Allow up to 2 minutes of future clock skew and up to 2 hours of past age
        if (timestamp > now + 120_000 || timestamp < now - 7_200_000) {
            return null;
        }

        return {
            companyId: companyId.trim(),
            disabledFeatures: Array.from(new Set(validatedKeys)),
            timestamp,
        };
    }

    /**
     * Broadcasts a feature revocation event across workers and evicts local sockets immediately.
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

        // 2. Perform immediate local socket eviction
        this.evictLocalSockets(normalizedCompanyId, validFeatures);

        // 3. Publish to Redis Pub/Sub with bounded retry for cross-worker delivery
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const eventPayload: FeatureRevocationEvent = {
                    companyId: normalizedCompanyId,
                    disabledFeatures: validFeatures,
                    timestamp: Date.now(),
                };

                const serialized = JSON.stringify(eventPayload);

                // Attempt bounded retry (up to 2 attempts)
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
            } else {
                // Redis is not connected or in standalone mode — local eviction is authoritative
                console.info(
                    `[FeatureRevocationService] Redis client status is '${redis?.status || 'uninitialized'}'. Local socket eviction executed for company ${normalizedCompanyId}.`
                );
            }
        } catch (err: any) {
            console.warn(
                `[FeatureRevocationService] Cross-worker publication error (local eviction succeeded): ${err?.message}`
            );
        }

        return { localEvicted: true, publishedToRedis };
    }

    /**
     * Evicts connected sockets belonging to the target company from protected feature rooms.
     */
    public static evictLocalSockets(
        companyId: string,
        disabledFeatures: FeatureFlagKey[]
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

            // Create a dedicated duplicate connection for subscribing
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
                console.info('[FeatureRevocationService] Redis subscriber connection ready. Purging stale local cache entries.');
                FeatureAccessService.clearAllCache();
            });

            subscriber.on('message', (channel: string, message: string) => {
                if (channel === FEATURE_REVOCATION_REDIS_CHANNEL) {
                    try {
                        const parsed = JSON.parse(message);
                        const validated = FeatureRevocationService.validateRevocationEvent(parsed);

                        if (!validated) {
                            console.warn('[FeatureRevocationService] Dropped malformed feature revocation event.');
                            return;
                        }

                        // Apply cache invalidation and local eviction on this worker
                        FeatureAccessService.invalidateCache(validated.companyId);
                        FeatureRevocationService.evictLocalSockets(validated.companyId, validated.disabledFeatures);
                    } catch (parseErr: any) {
                        console.error('[FeatureRevocationService] Failed to parse Redis message payload:', parseErr?.message);
                    }
                }
            });

            // Connect if disconnected
            if (subscriber.status === 'wait') {
                await subscriber.connect().catch((connErr) => {
                    console.warn('[FeatureRevocationService] Lazy connect failed for subscriber:', connErr?.message);
                });
            }

            // Subscribe to channel
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
