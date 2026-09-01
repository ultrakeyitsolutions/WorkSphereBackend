import { Document, Types } from 'mongoose';

export type LimitType = 'NONE' | 'LIMITED' | 'UNLIMITED';

export interface IPlanFeature {
    planId: Types.ObjectId;
    featureId: Types.ObjectId;

    enabled: boolean;

    // NONE      → boolean feature (no numeric limit)
    // LIMITED   → feature is enabled with a cap (value is set)
    // UNLIMITED → feature enabled, no cap (value is null)
    limitType: LimitType;

    value: number | null;   // null when UNLIMITED or NONE
}

export interface IPlanFeatureDocument extends IPlanFeature, Document {
    createdAt: Date;
    updatedAt: Date;
}

// ─── DTO used in Plan create / update request body ────────────────────────────
export interface PlanFeatureInput {
    featureId: string;
    enabled: boolean;
    limitType: LimitType;
    value?: number | null;
}
