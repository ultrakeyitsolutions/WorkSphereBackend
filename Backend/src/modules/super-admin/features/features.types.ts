import { Document } from 'mongoose';

export type FeatureType = 'BOOLEAN' | 'LIMIT';
export type FeatureUnit = 'COUNT' | 'GB' | 'MB' | 'PER_PROJECT' | 'DAYS' | 'NONE';

export interface IFeature {
    key: string;           // Unique uppercase identifier e.g. "TASK_MANAGEMENT"
    name: string;          // Display name  e.g. "Task Management"
    description: string;
    category: string;      // e.g. "productivity", "analytics", "storage"
    type: FeatureType;     // BOOLEAN = on/off, LIMIT = numeric cap
    unit: FeatureUnit;     // Unit for LIMIT features; NONE for BOOLEAN
    isActive: boolean;
}

export interface IFeatureDocument extends IFeature, Document {
    createdAt: Date;
    updatedAt: Date;
}
