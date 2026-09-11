import { Schema, model, Document, Types } from 'mongoose';

export type PlanUpgradeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IPlanUpgradeRequest {
    companyId: Types.ObjectId;
    requestedById: Types.ObjectId;
    currentPlanId?: Types.ObjectId;
    targetPlanId: Types.ObjectId;
    billingCycle?: string;
    message?: string;
    status: PlanUpgradeRequestStatus;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    rejectionReason?: string;
}

export interface IPlanUpgradeRequestDocument extends IPlanUpgradeRequest, Document {
    createdAt: Date;
    updatedAt: Date;
}

const planUpgradeRequestSchema = new Schema<IPlanUpgradeRequestDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        requestedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        currentPlanId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
        },
        targetPlanId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            required: true,
        },
        billingCycle: {
            type: String,
            enum: ['MONTHLY', 'SEMI_ANNUAL', 'YEARLY'],
        },
        message: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'REJECTED'],
            default: 'PENDING',
            index: true,
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        reviewedAt: {
            type: Date,
        },
        rejectionReason: {
            type: String,
        },
    },
    { timestamps: true }
);

export const PlanUpgradeRequest = model<IPlanUpgradeRequestDocument>(
    'PlanUpgradeRequest',
    planUpgradeRequestSchema
);
export default PlanUpgradeRequest;
