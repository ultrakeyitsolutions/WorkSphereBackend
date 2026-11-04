import { Schema, model } from 'mongoose';
import { IEscalationAuditDocument } from '../types/escalation.types';
import { EscalationAuditAction } from '../constants/escalation.constants';

const escalationAuditSchema = new Schema<IEscalationAuditDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        escalationCaseId: {
            type: Schema.Types.ObjectId,
            ref: 'EscalationCase',
            default: null,
            index: true,
        },
        ruleId: {
            type: Schema.Types.ObjectId,
            ref: 'EscalationRule',
            default: null,
            index: true,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        action: {
            type: String,
            enum: Object.values(EscalationAuditAction),
            required: true,
            index: true,
        },
        previousValue: {
            type: Schema.Types.Mixed,
            default: null,
        },
        newValue: {
            type: Schema.Types.Mixed,
            default: null,
        },
        reason: {
            type: String,
            trim: true,
            default: null,
        },
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: false,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
        toObject: { virtuals: true },
    }
);

// Indexes
escalationAuditSchema.index({ companyId: 1, escalationCaseId: 1, timestamp: -1 });
escalationAuditSchema.index({ companyId: 1, action: 1, timestamp: -1 });

export const EscalationAudit = model<IEscalationAuditDocument>(
    'EscalationAudit',
    escalationAuditSchema
);
export default EscalationAudit;
