/**
 * WorkSphere — Company Theme Realtime Event & Cache Propagation Service
 * Manages Socket.IO company-room broadcasting and Redis Pub/Sub cross-worker event delivery.
 *
 * Pattern:
 * - Emits 'company:theme.updated' to authenticated room 'company:<companyId>'
 * - Publishes to Redis channel 'worksphere:company_theme_updates'
 * - Dedupes and handles cross-worker cache eviction
 */

import { Server } from 'socket.io';
import { Types } from 'mongoose';
import Redis from 'ioredis';
import { getSocketServer } from '../../../sockets/socket-server';
import { getRedisClient } from '../../../config/redis';

export const COMPANY_THEME_REDIS_CHANNEL = 'worksphere:company_theme_updates';
export const COMPANY_THEME_SOCKET_EVENT = 'company:theme.updated';

export interface CompanyThemeUpdateEvent {
    companyId: string;
    version: number;
    updatedAt: string;
    updatedBy?: string | null;
    timestamp: number;
}

export class CompanyThemeRealtimeService {
    private static subscriberClient: Redis | null = null;
    private static isSubscribed = false;
    private static isInitializing = false;
    private static lastProcessedVersions = new Map<string, number>();

    /**
     * Validates an incoming theme update event strictly against schema & time bounds.
     */
    public static validateEvent(raw: any): CompanyThemeUpdateEvent | null {
        if (!raw || typeof raw !== 'object') return null;

        const { companyId, version, updatedAt, updatedBy, timestamp } = raw;

        if (
            typeof companyId !== 'string' ||
            companyId.trim().length === 0 ||
            !Types.ObjectId.isValid(companyId)
        ) {
            return null;
        }

        if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
            return null;
        }

        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
            return null;
        }

        const now = Date.now();
        // Allow up to 2 minutes future clock skew, up to 2 hours age
        if (timestamp > now + 120_000 || timestamp < now - 7_200_000) {
            return null;
        }

        return {
            companyId: companyId.trim(),
            version,
            updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(timestamp).toISOString(),
            updatedBy: updatedBy ? String(updatedBy) : null,
            timestamp,
        };
    }

    /**
     * Broadcasts theme update across workers and emits to local company sockets.
     */
    public static async broadcastThemeUpdate(
        companyId: string,
        version: number,
        updatedAt: Date | string = new Date(),
        updatedBy?: string | null
    ): Promise<{ localEmitted: boolean; publishedToRedis: boolean }> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            return { localEmitted: false, publishedToRedis: false };
        }

        const normalizedCompanyId = String(companyId).trim();
        const isoUpdatedAt = typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString();
        const timestamp = Date.now();

        const eventPayload: CompanyThemeUpdateEvent = {
            companyId: normalizedCompanyId,
            version,
            updatedAt: isoUpdatedAt,
            updatedBy: updatedBy || null,
            timestamp,
        };

        // 1. Emit locally via Socket.IO
        const localEmitted = this.emitLocalEvent(eventPayload);

        // 2. Publish to Redis Pub/Sub for cross-worker delivery
        let publishedToRedis = false;
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                const serialized = JSON.stringify(eventPayload);
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        await redis.publish(COMPANY_THEME_REDIS_CHANNEL, serialized);
                        publishedToRedis = true;
                        break;
                    } catch (publishErr: any) {
                        if (attempt === 2) {
                            console.warn(
                                `[CompanyThemeRealtimeService] Redis publish failed after 2 attempts: ${publishErr?.message}`
                            );
                        } else {
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                }
            } else {
                console.info(
                    `[CompanyThemeRealtimeService] Redis client status is '${redis?.status || 'uninitialized'}'. Local socket broadcast executed for company ${normalizedCompanyId}.`
                );
            }
        } catch (err: any) {
            console.warn(
                `[CompanyThemeRealtimeService] Cross-worker publication error (local emission succeeded): ${err?.message}`
            );
        }

        return { localEmitted, publishedToRedis };
    }

    /**
     * Emits theme update to connected sockets in room 'company:<companyId>' on this worker.
     */
    public static emitLocalEvent(event: CompanyThemeUpdateEvent): boolean {
        const io = getSocketServer();
        if (!io) return false;

        const lastVersion = this.lastProcessedVersions.get(event.companyId) || 0;
        if (event.version < lastVersion) {
            // Stale event rejected
            return false;
        }

        this.lastProcessedVersions.set(event.companyId, event.version);

        const room = `company:${event.companyId}`;
        io.to(room).emit(COMPANY_THEME_SOCKET_EVENT, {
            companyId: event.companyId,
            version: event.version,
            updatedAt: event.updatedAt,
            updatedBy: event.updatedBy,
        });

        return true;
    }

    /**
     * Initializes Redis Pub/Sub subscriber for cross-worker event reception.
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
                console.warn('[CompanyThemeRealtimeService] Redis subscriber error:', err?.message);
            });

            subscriber.on('connect', () => {
                console.info('[CompanyThemeRealtimeService] Redis subscriber connected.');
            });

            subscriber.on('message', async (channel: string, message: string) => {
                if (channel === COMPANY_THEME_REDIS_CHANNEL) {
                    try {
                        const parsed = JSON.parse(message);
                        const validated = CompanyThemeRealtimeService.validateEvent(parsed);
                        if (!validated) {
                            console.warn('[CompanyThemeRealtimeService] Dropped malformed theme update event.');
                            return;
                        }

                        // Dynamically import to prevent circular dependency
                        const { CompanyThemeService } = await import('./company-theme.service.js');
                        CompanyThemeService.invalidateCache(validated.companyId);

                        // Broadcast to local sockets
                        CompanyThemeRealtimeService.emitLocalEvent(validated);
                    } catch (parseErr: any) {
                        console.error('[CompanyThemeRealtimeService] Failed to process Redis message:', parseErr?.message);
                    }
                }
            });

            if (subscriber.status === 'wait') {
                await subscriber.connect().catch((connErr) => {
                    console.warn('[CompanyThemeRealtimeService] Lazy connect failed:', connErr?.message);
                });
            }

            await subscriber.subscribe(COMPANY_THEME_REDIS_CHANNEL);

            this.subscriberClient = subscriber;
            this.isSubscribed = true;
            this.isInitializing = false;
            console.info('[CompanyThemeRealtimeService] Successfully subscribed to theme updates channel.');
            return true;
        } catch (err: any) {
            console.warn('[CompanyThemeRealtimeService] Could not establish Redis subscriber:', err?.message);
            this.isSubscribed = false;
            this.isInitializing = false;
            return false;
        }
    }

    /**
     * Gracefully shutdown Redis subscriber.
     */
    public static async shutdown(): Promise<void> {
        if (this.subscriberClient) {
            try {
                await this.subscriberClient.unsubscribe(COMPANY_THEME_REDIS_CHANNEL);
                await this.subscriberClient.quit();
            } catch {
                // Ignore disconnect errors
            } finally {
                this.subscriberClient = null;
                this.isSubscribed = false;
                this.isInitializing = false;
            }
        }
    }
}
export default CompanyThemeRealtimeService;
