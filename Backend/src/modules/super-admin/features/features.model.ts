import { Schema, model } from 'mongoose';
import { IFeatureDocument } from './features.types';

const FeatureSchema = new Schema<IFeatureDocument>(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        // BOOLEAN = on/off toggle | LIMIT = numeric cap
        type: {
            type: String,
            required: true,
            enum: ['BOOLEAN', 'LIMIT'],
        },
        // Unit for LIMIT features; NONE for BOOLEAN
        unit: {
            type: String,
            required: true,
            enum: ['COUNT', 'GB', 'MB', 'PER_PROJECT', 'DAYS', 'NONE'],
            default: 'NONE',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

export const Feature = model<IFeatureDocument>('Feature', FeatureSchema);
export default Feature;
