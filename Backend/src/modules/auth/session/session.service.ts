import crypto from 'crypto';
import { Request } from 'express';
import { AuthSession, IAuthSessionDocument } from './auth-session.model';
import { Types } from 'mongoose';

export class SessionService {
    /**
     * Compute SHA-256 hash of refresh token
     */
    static hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Create a new session on login or MFA verification
     */
    static async createSession(params: {
        userId: string | Types.ObjectId;
        refreshToken: string;
        mfaVerifiedAt?: Date | null;
        req?: Request;
        deviceId?: string;
    }): Promise<IAuthSessionDocument> {
        const refreshTokenHash = this.hashToken(params.refreshToken);
        const deviceId = params.deviceId || crypto.randomUUID();
        const ipAddress = params.req
            ? (params.req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || params.req.ip || null
            : null;
        const userAgent = params.req?.headers['user-agent'] || null;

        // Refresh tokens expire in 7 days
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const session = new AuthSession({
            userId: new Types.ObjectId(params.userId),
            deviceId,
            refreshTokenHash,
            mfaVerifiedAt: params.mfaVerifiedAt || new Date(),
            ipAddress,
            userAgent,
            lastUsedAt: new Date(),
            expiresAt,
            revokedAt: null,
        });

        await session.save();
        return session;
    }

    /**
     * Validate an incoming refresh token against the active sessions
     */
    static async validateSession(refreshToken: string): Promise<IAuthSessionDocument | null> {
        const refreshTokenHash = this.hashToken(refreshToken);
        const session = await AuthSession.findOne({
            refreshTokenHash,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!session) {
            return null;
        }

        session.lastUsedAt = new Date();
        await session.save();
        return session;
    }

    /**
     * Rotate refresh token hash on refresh
     */
    static async rotateSessionToken(
        oldRefreshToken: string,
        newRefreshToken: string
    ): Promise<IAuthSessionDocument | null> {
        const oldHash = this.hashToken(oldRefreshToken);
        const newHash = this.hashToken(newRefreshToken);

        const session = await AuthSession.findOne({
            refreshTokenHash: oldHash,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!session) {
            return null;
        }

        session.refreshTokenHash = newHash;
        session.lastUsedAt = new Date();
        await session.save();
        return session;
    }

    /**
     * Revoke session on logout
     */
    static async revokeSessionByToken(refreshToken: string): Promise<boolean> {
        const refreshTokenHash = this.hashToken(refreshToken);
        const result = await AuthSession.updateOne(
            { refreshTokenHash, revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );
        return result.modifiedCount > 0;
    }

    /**
     * Revoke single session by ID
     */
    static async revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
        const result = await AuthSession.updateOne(
            { _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId), revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );
        return result.modifiedCount > 0;
    }

    /**
     * Revoke all sessions for a user (e.g., on password reset or logout-all)
     */
    static async revokeAllUserSessions(userId: string): Promise<number> {
        const result = await AuthSession.updateMany(
            { userId: new Types.ObjectId(userId), revokedAt: null },
            { $set: { revokedAt: new Date() } }
        );
        return result.modifiedCount;
    }

    /**
     * Get active sessions for a user (for Settings -> Security Sessions UI)
     */
    static async getUserSessions(userId: string) {
        const sessions = await AuthSession.find({
            userId: new Types.ObjectId(userId),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        })
            .sort({ lastUsedAt: -1 })
            .lean();

        return sessions.map((s) => ({
            id: s._id,
            deviceId: s.deviceId,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            mfaVerifiedAt: s.mfaVerifiedAt,
            lastUsedAt: s.lastUsedAt,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
        }));
    }
}
