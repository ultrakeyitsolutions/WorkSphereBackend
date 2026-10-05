/**
 * Redis client configuration for WorkSphere.
 *
 * Uses ioredis (already listed in package.json).
 * The client is created as a singleton — only one connection is shared
 * across the entire process.
 *
 * Design decisions:
 *  - If REDIS_URL is not set the client is created but will fail
 *    gracefully (lazyConnect=true) so that services that depend on
 *    Redis can fall back to direct DB calls instead of crashing the
 *    server on startup.
 *  - All Redis errors are logged but never re-thrown so that the
 *    application keeps running even without a Redis instance.
 */

import Redis from 'ioredis';

let redisClient: Redis | null = null;

/**
 * Returns the singleton Redis client, creating it on first call.
 * Never throws — if Redis is unavailable the client is returned in
 * a disconnected state and callers should handle errors gracefully.
 */
export function getRedisClient(): Redis {
    if (redisClient) {
        return redisClient;
    }

    const redisUrl = process.env.REDIS_URL;
    const password = process.env.REDIS_PASSWORD || process.env.REDIS_API_KEY || undefined;
    const username = process.env.REDIS_USERNAME || undefined;
    const isTls = process.env.REDIS_TLS === 'true' || Boolean(redisUrl?.startsWith('rediss://'));

    redisClient = redisUrl
        ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
        : new Redis({
              host: process.env.REDIS_HOST || '127.0.0.1',
              port: parseInt(process.env.REDIS_PORT || '6379', 10),
              username,
              password,
              tls: isTls ? {} : undefined,
              lazyConnect: true,
              maxRetriesPerRequest: 1,
          });

    redisClient.on('error', (err) => {
        // Log but do NOT crash — Redis is a performance optimisation, not
        // a hard dependency.
        console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
        console.info('[Redis] Connected successfully');
    });

    return redisClient;
}

/**
 * Attempt a Redis GET, returning null on any failure.
 */
export async function redisGet(key: string): Promise<string | null> {
    try {
        const client = getRedisClient();
        return await client.get(key);
    } catch (err: any) {
        console.warn('[Redis] GET failed:', err?.message);
        return null;
    }
}

/**
 * Attempt a Redis SET with an expiry (in seconds), silently failing.
 */
export async function redisSet(
    key: string,
    value: string,
    ttlSeconds: number
): Promise<void> {
    try {
        const client = getRedisClient();
        await client.set(key, value, 'EX', ttlSeconds);
    } catch (err: any) {
        console.warn('[Redis] SET failed:', err?.message);
    }
}
