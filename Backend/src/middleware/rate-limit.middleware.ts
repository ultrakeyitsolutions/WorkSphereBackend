import { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyAccessToken } from '../utils/tokens';
import { env } from '../config/env';

/**
 * Derives a rate limit key for incoming requests.
 * If the request contains a valid Bearer access token, keys by the authenticated user (`user:<userId>`).
 * Otherwise, falls back to the normalized client IP (`ip:<normalized-ip>`) supporting IPv4 & IPv6 subnets.
 */
export const getRateLimitKey = (req: Request): string => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token) {
            try {
                const decoded = verifyAccessToken(token);
                if (decoded && decoded.userId) {
                    (req as any).rateLimitUser = decoded.userId;
                    return `user:${decoded.userId}`;
                }
            } catch {
                // Invalid or expired token; fallback to client IP
            }
        }
    }

    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return `ip:${ipKeyGenerator(clientIp)}`;
};

/**
 * Production general API rate limiter.
 * - Authenticated users get an enterprise allowance (default: 1500 req / 15 min ~ 100 req/min)
 *   keyed by their verified user ID.
 * - Unauthenticated traffic gets a strict IP-based limit (default: 200 req / 15 min ~ 13 req/min)
 *   preventing credential stuffing and scraping without blocking legitimate traffic.
 * - Health checks and Super Admin routes are exempted from the general limiter.
 * - Targeted logging records detailed client diagnostics on 429 errors.
 */
export const apiRateLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: (req) => {
        // Evaluate user key if not already cached
        if (!(req as any).rateLimitUser && req.headers.authorization?.startsWith('Bearer ')) {
            try {
                const token = req.headers.authorization.substring(7).trim();
                const decoded = verifyAccessToken(token);
                if (decoded && decoded.userId) {
                    (req as any).rateLimitUser = decoded.userId;
                }
            } catch {
                // Ignore token verification errors
            }
        }

        return (req as any).rateLimitUser
            ? env.RATE_LIMIT_MAX_AUTH
            : env.RATE_LIMIT_MAX_UNAUTH;
    },
    keyGenerator: (req) => getRateLimitKey(req),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => {
        // Skip during explicit benchmark / load test executions
        if (process.env.LOAD_TEST === 'true') {
            return true;
        }

        // Health check endpoints for AWS ALB / monitoring probes
        if (req.path === '/health' || req.originalUrl === '/health' || req.originalUrl === '/api/health') {
            return true;
        }

        // Super Admin routes (already guarded by requireSuperAdmin)
        const url = req.originalUrl.toLowerCase();
        if (
            url.startsWith('/api/super-admin') ||
            url.startsWith('/api/superadmin') ||
            url.startsWith('/api/v1/super-admin') ||
            url.startsWith('/api/v1/superadmin')
        ) {
            return true;
        }

        return false;
    },
    handler: (req: Request, res: Response, _next: NextFunction, options) => {
        const rateLimitKey = (req as any).rateLimitUser
            ? `user:${(req as any).rateLimitUser}`
            : `ip:${req.ip}`;

        const logPayload = {
            event: 'RATE_LIMIT_EXCEEDED',
            key: rateLimitKey,
            ip: req.ip,
            userId: (req as any).rateLimitUser || null,
            method: req.method,
            url: req.originalUrl,
            forwardedFor: req.headers['x-forwarded-for'] || null,
            userAgent: req.headers['user-agent'] || null,
        };

        if ((req as any).log) {
            (req as any).log.warn(logPayload, 'HTTP 429 Rate limit exceeded');
        } else {
            console.warn('[RateLimit] HTTP 429 Rate limit exceeded:', JSON.stringify(logPayload));
        }

        res.status(options.statusCode).json({
            success: false,
            message: 'Too many requests. Please slow down and try again later.',
            retryAfter: Math.ceil(options.windowMs / 1000),
        });
    },
});
