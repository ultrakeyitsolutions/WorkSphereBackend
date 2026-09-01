import { Document, Types } from 'mongoose';
import { SubscriptionStatus } from './subscription.types';

export enum SubscriptionEventType {
    SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
    PLAN_UPGRADED = 'PLAN_UPGRADED',
    PLAN_DOWNGRADED = 'PLAN_DOWNGRADED',
    SUBSCRIPTION_PAUSED = 'SUBSCRIPTION_PAUSED',
    SUBSCRIPTION_RESUMED = 'SUBSCRIPTION_RESUMED',
    SUBSCRIPTION_CANCELLED = 'SUBSCRIPTION_CANCELLED',
    SUBSCRIPTION_REACTIVATED = 'SUBSCRIPTION_REACTIVATED',
    PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED',
    PAYMENT_FAILED = 'PAYMENT_FAILED',
}

export interface ISubscriptionEvent {
    subscriptionId: Types.ObjectId;
    companyId: Types.ObjectId;
    type: SubscriptionEventType;

    fromPlanId?: Types.ObjectId;
    toPlanId?: Types.ObjectId;

    fromStatus?: SubscriptionStatus;
    toStatus?: SubscriptionStatus;

    effectiveAt: Date;
    performedBy?: Types.ObjectId; // User ID
    metadata?: Record<string, any>;
}

export interface ISubscriptionEventDocument extends ISubscriptionEvent, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
