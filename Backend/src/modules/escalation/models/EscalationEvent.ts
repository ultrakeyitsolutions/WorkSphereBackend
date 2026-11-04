import { Schema, model } from 'mongoose';
import { IEscalationEventDocument } from '../types/escalation.types';
import {
    EscalationCategory,
    EscalationSourceModule,
    VerificationStatus,
} from '../constants/escalation.constants';

const escalationEventSchema = new Schema<IEscalationEventDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        employeeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        category: {
            type: String,
            enum: Object.values(EscalationCategory),
            required: true,
            index: true,
        },
        sourceModule: {
            type: String,
            enum: Object.values(EscalationSourceModule),
            required: true,
            index: true,
        },
        sourceRecordId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        ruleId: {
            type: Schema.Types.ObjectId,
            ref: 'EscalationRule',
            default: null,
            index: true,
        },
        eventDate: {
            type: String, // YYYY-MM-DD
            required: true,
            trim: true,
            index: true,
        },
        eventTimestamp: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
        expectedValue: {
            type: String,
            default: '',
            trim: true,
        },
        actualValue: {
            type: String,
            default: '',
            trim: true,
        },
        violationDuration: {
            type: Number,
            default: 0,
            min: 0,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        verificationStatus: {
            type: String,
            enum: Object.values(VerificationStatus),
            default: VerificationStatus.VERIFIED,
            index: true,
        },
        idempotencyKey: {
            type: String,
            trim: true,
            index: true,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
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
// Idempotency: avoid creating duplicate violation events for the same source record, category and cycle date
escalationEventSchema.index(
    { companyId: 1, employeeId: 1, category: 1, eventDate: 1, sourceRecordId: 1 },
    { unique: true, sparse: true }
);

// Optional unique index on custom idempotencyKey if provided
escalationEventSchema.index(
    { companyId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

escalationEventSchema.index({ companyId: 1, employeeId: 1, eventTimestamp: -1 });
escalationEventSchema.index({ companyId: 1, category: 1, eventDate: -1 });
escalationEventSchema.index({ companyId: 1, verificationStatus: 1, eventDate: -1 });

export const EscalationEvent = model<IEscalationEventDocument>(
    'EscalationEvent',
    escalationEventSchema
);
export default EscalationEvent;
