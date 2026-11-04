import { Schema, model } from 'mongoose';
import {
    IEscalationCaseDocument,
    INotifiedUserEntry,
    IEmployeeExplanation,
    ISupportingEvidence,
    IManagerComment,
} from '../types/escalation.types';
import {
    EscalationCategory,
    EscalationCaseStatus,
} from '../constants/escalation.constants';

const notifiedUserSchema = new Schema<INotifiedUserEntry>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, required: true },
        notifiedAt: { type: Date, default: Date.now },
        level: { type: Number, required: true },
    },
    { _id: false }
);

const employeeExplanationSchema = new Schema<IEmployeeExplanation>(
    {
        text: { type: String, required: true, trim: true },
        submittedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const supportingEvidenceSchema = new Schema<ISupportingEvidence>(
    {
        fileUrl: { type: String, required: true, trim: true },
        fileName: { type: String, required: true, trim: true },
        fileType: { type: String, required: true, trim: true },
        fileSize: { type: Number, required: true },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const managerCommentSchema = new Schema<IManagerComment>(
    {
        managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        comment: { type: String, required: true, trim: true },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const escalationCaseSchema = new Schema<IEscalationCaseDocument>(
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
        eventId: {
            type: Schema.Types.ObjectId,
            ref: 'EscalationEvent',
            required: true,
            index: true,
        },
        ruleId: {
            type: Schema.Types.ObjectId,
            ref: 'EscalationRule',
            default: null,
            index: true,
        },
        category: {
            type: String,
            enum: Object.values(EscalationCategory),
            required: true,
            index: true,
        },
        escalationLevel: {
            type: Number,
            required: true,
            default: 1,
            index: true,
        },
        occurrenceCount: {
            type: Number,
            required: true,
            default: 1,
        },
        cycleStartDate: {
            type: Date,
            required: true,
            index: true,
        },
        cycleEndDate: {
            type: Date,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(EscalationCaseStatus),
            default: EscalationCaseStatus.PENDING,
            required: true,
            index: true,
        },
        assignedManager: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        notifiedUsers: {
            type: [notifiedUserSchema],
            default: [],
        },
        employeeExplanation: {
            type: employeeExplanationSchema,
            default: null,
        },
        supportingEvidence: {
            type: [supportingEvidenceSchema],
            default: [],
        },
        managerComments: {
            type: [managerCommentSchema],
            default: [],
        },
        resolutionReason: {
            type: String,
            default: null,
            trim: true,
        },
        resolvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
        dueAt: {
            type: Date,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
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

// Compound Indexes for fast queries, analytics, and tenant boundaries
escalationCaseSchema.index({ companyId: 1, employeeId: 1, category: 1, status: 1 });
escalationCaseSchema.index({ companyId: 1, status: 1, dueAt: 1 });
escalationCaseSchema.index({ companyId: 1, assignedManager: 1, status: 1 });
escalationCaseSchema.index({ companyId: 1, eventId: 1 }, { unique: true });
escalationCaseSchema.index({ companyId: 1, createdAt: -1 });

export const EscalationCase = model<IEscalationCaseDocument>(
    'EscalationCase',
    escalationCaseSchema
);
export default EscalationCase;
