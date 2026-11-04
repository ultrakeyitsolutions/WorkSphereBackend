import { getRedisClient } from '../../../config/redis';
import { getSocketServer } from '../../../sockets/socket-server';

export const SUPERADMIN_NOTIFICATION_REDIS_CHANNEL = 'worksphere:superadmin:notifications';

export interface SuperAdminRedisBroadcastPayload {
    event: 'superadmin:notification:new' | 'superadmin:notification:unread-count' | 'superadmin:notification:read';
    recipientId?: string;
    notification?: any;
    unreadCount?: number;
    notificationId?: string;
    timestamp: number;
}

export class SuperAdminNotificationRedisService {
    private static isSubscribed = false;

    /**
     * Initializes multi-instance Redis Pub/Sub subscription for SuperAdmin notifications.
     * Safe to call multiple times (idempotent).
     */
    public static initRedisSubscriber(): void {
        if (this.isSubscribed) return;

        try {
            const redis = getRedisClient();
            if (!redis) {
                console.warn('[SuperAdminRedis] Redis client not configured, skipping subscriber.');
                return;
            }

            const subscriber = redis.duplicate();

            subscriber.subscribe(SUPERADMIN_NOTIFICATION_REDIS_CHANNEL, (err) => {
                if (err) {
                    console.warn('[SuperAdminRedis] Failed to subscribe to channel:', err.message);
                } else {
                    this.isSubscribed = true;
                    console.info(`[SuperAdminRedis] Subscribed to ${SUPERADMIN_NOTIFICATION_REDIS_CHANNEL}`);
                }
            });

            subscriber.on('message', (channel, message) => {
                if (channel === SUPERADMIN_NOTIFICATION_REDIS_CHANNEL) {
                    try {
                        const payload: SuperAdminRedisBroadcastPayload = JSON.parse(message);
                        this.handleRemoteBroadcast(payload);
                    } catch (parseErr: any) {
                        console.warn('[SuperAdminRedis] Failed parsing pub/sub message:', parseErr?.message);
                    }
                }
            });

            subscriber.on('error', (err) => {
                console.warn('[SuperAdminRedis] Subscriber error:', err?.message);
            });
        } catch (err: any) {
            console.warn('[SuperAdminRedis] Redis subscriber initialization skipped:', err?.message);
        }
    }

    /**
     * Publish an event to the Redis cluster channel.
     * Non-blocking and never throws.
     */
    public static async publishEvent(payload: SuperAdminRedisBroadcastPayload): Promise<void> {
        try {
            const redis = getRedisClient();
            if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                await redis.publish(SUPERADMIN_NOTIFICATION_REDIS_CHANNEL, JSON.stringify(payload));
            }
        } catch (err: any) {
            console.warn('[SuperAdminRedis] Failed publishing event to Redis:', err?.message);
        }
    }

    /**
     * Internal handler when a message arrives from another backend instance.
     */
    private static handleRemoteBroadcast(payload: SuperAdminRedisBroadcastPayload): void {
        const io = getSocketServer();
        if (!io) return;

        const { event, recipientId, notification, unreadCount, notificationId } = payload;

        switch (event) {
            case 'superadmin:notification:new': {
                // Emit to dedicated SuperAdmin room and recipient's specific room
                io.to('superadmin').emit('superadmin:notification:new', notification);
                if (recipientId) {
                    io.to(`user:${recipientId}`).emit('superadmin:notification:new', notification);
                }
                break;
            }
            case 'superadmin:notification:unread-count': {
                if (recipientId && typeof unreadCount === 'number') {
                    io.to(`user:${recipientId}`).emit('superadmin:notification:unread-count', { unreadCount });
                }
                break;
            }
            case 'superadmin:notification:read': {
                io.to('superadmin').emit('superadmin:notification:read', { notificationId, recipientId });
                if (recipientId) {
                    io.to(`user:${recipientId}`).emit('superadmin:notification:read', { notificationId, recipientId });
                }
                break;
            }
        }
    }
}
