import { Schema, model } from 'mongoose';
import { ISubscriptionEventDocument, SubscriptionEventType } from './subscription-event.types';
import { SubscriptionStatus } from './subscription.types';

const subscriptionEventSchema = new Schema<ISubscriptionEventDocument>(
    {
        subscriptionId: {
            type: Schema.Types.ObjectId,
            ref: 'Subscription',
            required: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
        },
        type: {
            type: String,
            enum: Object.values(SubscriptionEventType),
            required: true,
        },
        fromPlanId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
        },
        toPlanId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
        },
        fromStatus: {
            type: String,
            enum: Object.values(SubscriptionStatus),
        },
        toStatus: {
            type: String,
            enum: Object.values(SubscriptionStatus),
        },
        effectiveAt: {
            type: Date,
            required: true,
        },
        performedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

subscriptionEventSchema.index({ subscriptionId: 1 });
subscriptionEventSchema.index({ companyId: 1 });
subscriptionEventSchema.index({ type: 1 });

export const SubscriptionEvent = model<ISubscriptionEventDocument>('SubscriptionEvent', subscriptionEventSchema);
export default SubscriptionEvent;
