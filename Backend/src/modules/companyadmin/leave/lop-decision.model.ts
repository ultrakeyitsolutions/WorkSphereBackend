import { Schema, model } from 'mongoose';
import { ILopDecisionDocument, ILopAuditTrailEntry } from './leave-policy.types';

const lopAuditTrailSchema = new Schema<ILopAuditTrailEntry>(
    {
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        action: {
            type: String,
            enum: ['PROPOSED', 'ADJUSTED', 'APPROVED', 'REJECTED', 'CORRECTION'],
            required: true,
        },
        reason: {
            type: String,
            trim: true,
            default: '',
        },
        previousAmount: {
            type: Number,
            default: null,
        },
        newAmount: {
            type: Number,
            default: null,
        },
        timestamp: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

const lopDecisionSchema = new Schema<ILopDecisionDocument>(
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
        leaveRequestId: {
            type: Schema.Types.ObjectId,
            ref: 'LeaveRequest',
            required: true,
            index: true,
        },
        month: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}$/,
            index: true,
        },
        lopDays: {
            type: Number,
            required: true,
            min: 0.5,
        },
        calculationMethod: {
            type: String,
            enum: ['FIXED_AMOUNT', 'SALARY_DIVISOR'],
            required: true,
        },
        baseSalaryUsed: {
            type: Number,
            default: null,
        },
        divisorUsed: {
            type: Number,
            default: null,
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
        },
        calculatedDeductionAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        finalDeductionAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        status: {
            type: String,
            enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'ADJUSTED'],
            default: 'PROPOSED',
            index: true,
        },
        adminOverrideReason: {
            type: String,
            trim: true,
            default: null,
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        approvedAt: {
            type: Date,
            default: null,
        },
        rejectionReason: {
            type: String,
            trim: true,
            default: null,
        },
        isEstimated: {
            type: Boolean,
            default: true,
        },
        emailDeliveryStatus: {
            type: String,
            enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'],
            default: 'PENDING',
        },
        emailDeliveryError: {
            type: String,
            default: null,
        },
        emailSentAt: {
            type: Date,
            default: null,
        },
        auditTrail: {
            type: [lopAuditTrailSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

lopDecisionSchema.index({ companyId: 1, month: 1, status: 1 });
lopDecisionSchema.index({ companyId: 1, employeeId: 1, createdAt: -1 });

export const LopDecision = model<ILopDecisionDocument>('LopDecision', lopDecisionSchema);
export default LopDecision;
