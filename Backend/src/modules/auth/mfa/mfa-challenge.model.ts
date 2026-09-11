import { Schema, model, Document, Types } from 'mongoose';

export interface IMfaChallengeDocument extends Document {
    userId: Types.ObjectId;
    challengeId: string;
    purpose: 'LOGIN' | 'PASSWORD_RESET';
    expiresAt: Date;
    attempts: number;
    maxAttempts: number;
    usedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const mfaChallengeSchema = new Schema<IMfaChallengeDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        challengeId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        purpose: {
            type: String,
            enum: ['LOGIN', 'PASSWORD_RESET'],
            default: 'LOGIN',
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }, // TTL index automatically removes expired docs
        },
        attempts: {
            type: Number,
            default: 0,
        },
        maxAttempts: {
            type: Number,
            default: 5,
        },
        usedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'mfa_challenges',
    }
);

export const MfaChallenge = model<IMfaChallengeDocument>('MfaChallenge', mfaChallengeSchema);
export default MfaChallenge;
