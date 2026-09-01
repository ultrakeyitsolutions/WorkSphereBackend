import { Schema, model } from 'mongoose';
import { IAuditLogDocument, AuditAction } from './audit-log.types';

const auditLogSchema = new Schema<IAuditLogDocument>(
    {
        action: {
            type: String,
            enum: Object.values(AuditAction),
            required: true,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        actorEmail: {
            type: String,
            default: null,
        },
        actorRole: {
            type: String,
            default: null,
        },
        targetUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        targetEmail: {
            type: String,
            default: null,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            default: null,
        },
        companyName: {
            type: String,
            default: null,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        ipAddress: {
            type: String,
            default: null,
        },
        userAgent: {
            type: String,
            default: null,
        },
        success: {
            type: Boolean,
            required: true,
            default: true,
        },
        description: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// ─── Indexes for fast super-admin filtering ───────────────────────────────────
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ actorId: 1 });
auditLogSchema.index({ companyId: 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ success: 1 });
auditLogSchema.index({ actorEmail: 1 });

export const AuditLog = model<IAuditLogDocument>('AuditLog', auditLogSchema);
export default AuditLog;
