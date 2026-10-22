import { Schema, model, Document, Types } from 'mongoose';

export type WebhookProcessingStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'IGNORED';

export interface IPaymentWebhookEvent {
    provider: 'RAZORPAY';
    providerEventId: string;
    eventType: string;
    payload: Record<string, any>;
    status: WebhookProcessingStatus;
    processingError?: string | null;
    retryCount: number;
    processedAt?: Date | null;
    receivedAt: Date;
    metadata?: Record<string, any>;
}

export interface IPaymentWebhookEventDocument extends IPaymentWebhookEvent, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const paymentWebhookEventSchema = new Schema<IPaymentWebhookEventDocument>(
    {
        provider: {
            type: String,
            enum: ['RAZORPAY'],
            default: 'RAZORPAY',
            required: true,
        },
        providerEventId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        payload: {
            type: Schema.Types.Mixed,
            required: true,
        },
        status: {
            type: String,
            enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED'],
            default: 'RECEIVED',
            required: true,
            index: true,
        },
        processingError: {
            type: String,
            default: null,
        },
        retryCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        processedAt: {
            type: Date,
            default: null,
        },
        receivedAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

paymentWebhookEventSchema.index({ status: 1, receivedAt: 1 });

export const PaymentWebhookEvent = model<IPaymentWebhookEventDocument>(
    'PaymentWebhookEvent',
    paymentWebhookEventSchema
);
export default PaymentWebhookEvent;
