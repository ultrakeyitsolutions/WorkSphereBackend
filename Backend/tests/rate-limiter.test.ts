import { describe, it, expect, vi } from 'vitest';
import { getRateLimitKey } from '../src/middleware/rate-limit.middleware';
import * as tokens from '../src/utils/tokens';

describe('Rate Limiter Middleware', () => {
    it('should key by client IP when unauthenticated', () => {
        const req = {
            headers: {},
            ip: '192.168.1.100',
        } as any;

        const key = getRateLimitKey(req);
        expect(key).toContain('ip:');
    });

    it('should key by userId when valid bearer token is present', () => {
        vi.spyOn(tokens, 'verifyAccessToken').mockReturnValue({
            userId: 'user_12345',
            email: 'user@test.com',
            role: 'User',
        } as any);

        const req = {
            headers: {
                authorization: 'Bearer valid.jwt.token',
            },
            ip: '192.168.1.100',
        } as any;

        const key = getRateLimitKey(req);
        expect(key).toBe('user:user_12345');
    });

    it('should fallback to IP when token verification fails', () => {
        vi.spyOn(tokens, 'verifyAccessToken').mockImplementation(() => {
            throw new Error('Invalid token');
        });

        const req = {
            headers: {
                authorization: 'Bearer invalid.token',
            },
            ip: '192.168.1.100',
        } as any;

        const key = getRateLimitKey(req);
        expect(key).toContain('ip:');
    });
});
