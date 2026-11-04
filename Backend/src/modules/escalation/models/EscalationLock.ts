import { Schema, model, Document } from 'mongoose';

export interface IEscalationLockDocument extends Document {
    lockKey: string;
    owner: string;
    expiresAt: Date;
    acquiredAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const escalationLockSchema = new Schema<IEscalationLockDocument>(
    {
        lockKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        owner: {
            type: String,
            required: true,
            trim: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },
        acquiredAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// TTL index to automatically clean up any stale lock records after expiry
escalationLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const EscalationLock = model<IEscalationLockDocument>(
    'EscalationLock',
    escalationLockSchema
);
export default EscalationLock;

