import { Document, Types } from 'mongoose';

export enum SubscriptionStatus {
    TRIALING = 'TRIALING',
    ACTIVE = 'ACTIVE',
    PAST_DUE = 'PAST_DUE',
    PAUSED = 'PAUSED',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED',
    PENDING = 'PENDING',
}

export interface ISubscription {
    companyId: Types.ObjectId;
    planId: Types.ObjectId;

    status: SubscriptionStatus;

    startedAt: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;

    cancelAtPeriodEnd: boolean;
    scheduledPlanId?: Types.ObjectId | null;

    pausedAt?: Date | null;
    resumeAt?: Date | null;
    pauseReason?: string;

    cancellationReason?: string;
}

export interface ISubscriptionDocument extends ISubscription, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
