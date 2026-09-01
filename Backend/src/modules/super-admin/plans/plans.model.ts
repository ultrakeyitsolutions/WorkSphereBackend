import { Schema, model } from 'mongoose';
import { IPlanDocument } from './plans.types';

const PlanSchema = new Schema<IPlanDocument>(
    {
        name: { type: String, required: true, unique: true, trim: true },

        code: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },

        description: { type: String, required: true, trim: true },

        billingCycle: {
            type: String,
            required: true,
            enum: ['MONTHLY', 'SEMI_ANNUAL', 'YEARLY'],
        },

        price: { type: Number, required: true, min: 0 },

        currency: {
            type: String,
            required: true,
            default: 'INR',
            uppercase: true,
            trim: true,
        },

        trialPeriodDays: { type: Number, default: 0, min: 0 },

        isActive: { type: Boolean, default: true },
        isDefault: { type: Boolean, default: false },
        isArchived: { type: Boolean, default: false },  // soft-delete
    },
    { timestamps: true }
);

// Feature entitlements are stored in PlanFeature — NOT embedded here.
// This allows new features to be added without touching Plan documents.

export const Plan = model<IPlanDocument>('Plan', PlanSchema);
export default Plan;