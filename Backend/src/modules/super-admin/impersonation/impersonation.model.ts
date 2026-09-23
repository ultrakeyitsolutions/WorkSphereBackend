import { Schema, model } from 'mongoose';
import { IImpersonationSessionDocument, ImpersonationStatus } from './impersonation.types';

const impersonationSessionSchema = new Schema<IImpersonationSessionDocument>(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        originalUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        targetUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        targetCompanyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(ImpersonationStatus),
            default: ImpersonationStatus.ACTIVE,
            required: true,
        },
        startedAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        endedAt: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        ipAddress: {
            type: String,
            default: null,
        },
        userAgent: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'impersonation_sessions',
    }
);

// ── Compound & Performance Indexes ───────────────────────────────────────────
impersonationSessionSchema.index({ originalUserId: 1, status: 1 });
impersonationSessionSchema.index({ targetUserId: 1, status: 1 });
impersonationSessionSchema.index({ targetCompanyId: 1, startedAt: -1 });
impersonationSessionSchema.index({ expiresAt: 1 });

export const ImpersonationSession = model<IImpersonationSessionDocument>(
    'ImpersonationSession',
    impersonationSessionSchema
);

export default ImpersonationSession;
