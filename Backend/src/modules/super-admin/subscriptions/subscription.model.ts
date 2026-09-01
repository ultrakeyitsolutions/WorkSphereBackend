import { Schema, model } from 'mongoose';
import { ISubscriptionDocument, SubscriptionStatus } from './subscription.types';

const subscriptionSchema = new Schema<ISubscriptionDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            unique: true, // One active subscription per company at a time for now, or just index. Actually, let's keep it 1:1 active. We can just index it.
        },
        planId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(SubscriptionStatus),
            default: SubscriptionStatus.PENDING,
            required: true,
        },
        startedAt: {
            type: Date,
            required: true,
        },
        currentPeriodStart: {
            type: Date,
            required: true,
        },
        currentPeriodEnd: {
            type: Date,
            required: true,
        },
        cancelAtPeriodEnd: {
            type: Boolean,
            default: false,
        },
        scheduledPlanId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            default: null,
        },
        pausedAt: {
            type: Date,
            default: null,
        },
        resumeAt: {
            type: Date,
            default: null,
        },
        pauseReason: {
            type: String,
        },
        cancellationReason: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

subscriptionSchema.index({ companyId: 1 });
subscriptionSchema.index({ status: 1 });

export const Subscription = model<ISubscriptionDocument>('Subscription', subscriptionSchema);
export default Subscription;
