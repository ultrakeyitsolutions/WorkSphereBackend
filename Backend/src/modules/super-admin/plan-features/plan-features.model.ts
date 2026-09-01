import { Schema, model } from 'mongoose';
import { IPlanFeatureDocument } from './plan-features.types';

const PlanFeatureSchema = new Schema<IPlanFeatureDocument>(
    {
        planId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            required: true,
        },
        featureId: {
            type: Schema.Types.ObjectId,
            ref: 'Feature',
            required: true,
        },
        enabled: {
            type: Boolean,
            required: true,
            default: true,
        },
        // NONE      → boolean feature
        // LIMITED   → numeric cap (value is a positive number)
        // UNLIMITED → no cap (value must be null)
        limitType: {
            type: String,
            required: true,
            enum: ['NONE', 'LIMITED', 'UNLIMITED'],
        },
        value: {
            type: Number,
            default: null,
        },
    },
    { timestamps: true }
);

// ─── Compound Unique Index ────────────────────────────────────────────────────
// A plan cannot have the same feature configured twice.
PlanFeatureSchema.index({ planId: 1, featureId: 1 }, { unique: true });

export const PlanFeature = model<IPlanFeatureDocument>('PlanFeature', PlanFeatureSchema);
export default PlanFeature;
