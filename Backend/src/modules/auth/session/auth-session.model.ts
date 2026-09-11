import { Schema, model, Document, Types } from 'mongoose';

export interface IAuthSessionDocument extends Document {
    userId: Types.ObjectId;
    deviceId: string;
    refreshTokenHash: string;
    mfaVerifiedAt?: Date | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    lastUsedAt: Date;
    expiresAt: Date;
    revokedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const authSessionSchema = new Schema<IAuthSessionDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        deviceId: {
            type: String,
            required: true,
            index: true,
        },
        refreshTokenHash: {
            type: String,
            required: true,
            index: true,
        },
        mfaVerifiedAt: {
            type: Date,
            default: null,
        },
        ipAddress: {
            type: String,
            default: null,
        },
        userAgent: {
            type: String,
            default: null,
        },
        lastUsedAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }, // TTL index
        },
        revokedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'auth_sessions',
    }
);

export const AuthSession = model<IAuthSessionDocument>('AuthSession', authSessionSchema);
export default AuthSession;
