import { Schema, model, Document, Types } from 'mongoose';

export type OutboxJobType = 'ENTITLEMENT_ACTIVATION' | 'PAYMENT_NOTIFICATION' | 'RECONCILIATION';
export type OutboxJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';

export interface IPaymentOutboxJob {
    jobId: string;
    type: OutboxJobType;
    companyId: Types.ObjectId;
    attemptId?: string | null;
    deduplicationKey: string;
    payload: Record<string, any>;
    status: OutboxJobStatus;
    attempts: number;
    maxAttempts: number;
    nextRunAt: Date;
    lockedAt?: Date | null;
    lockedBy?: string | null;
    lastError?: string | null;
    completedAt?: Date | null;
}

export interface IPaymentOutboxJobDocument extends IPaymentOutboxJob, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const paymentOutboxJobSchema = new Schema<IPaymentOutboxJobDocument>(
    {
        jobId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        type: {
            type: String,
            enum: ['ENTITLEMENT_ACTIVATION', 'PAYMENT_NOTIFICATION', 'RECONCILIATION'],
            required: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        attemptId: {
            type: String,
            default: null,
            index: true,
        },
        deduplicationKey: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        payload: {
            type: Schema.Types.Mixed,
            required: true,
        },
        status: {
            type: String,
            enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'],
            default: 'PENDING',
            required: true,
            index: true,
        },
        attempts: {
            type: Number,
            default: 0,
            min: 0,
        },
        maxAttempts: {
            type: Number,
            default: 5,
            min: 1,
        },
        nextRunAt: {
            type: Date,
            default: Date.now,
            required: true,
            index: true,
        },
        lockedAt: {
            type: Date,
            default: null,
        },
        lockedBy: {
            type: String,
            default: null,
        },
        lastError: {
            type: String,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

paymentOutboxJobSchema.index({ status: 1, nextRunAt: 1 });
paymentOutboxJobSchema.index({ lockedAt: 1 });

export const PaymentOutboxJob = model<IPaymentOutboxJobDocument>(
    'PaymentOutboxJob',
    paymentOutboxJobSchema
);
export default PaymentOutboxJob;
