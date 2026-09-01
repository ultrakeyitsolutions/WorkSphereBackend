import { Document } from 'mongoose';

export type BillingCycle = 'MONTHLY' | 'SEMI_ANNUAL' | 'YEARLY';

export interface IPlan {
    name: string;
    code: string;
    description: string;

    billingCycle: BillingCycle;

    price: number;
    currency: string;

    trialPeriodDays: number;

    isActive: boolean;
    isDefault: boolean;
    isArchived: boolean;        // soft-delete; archived plans can't be subscribed to
}

export interface IPlanDocument extends IPlan, Document {
    createdAt: Date;
    updatedAt: Date;
}