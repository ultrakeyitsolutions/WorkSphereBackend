import { Schema, model, Document, Types } from 'mongoose';
import {
    ISuperAdminPreference,
    SUPERADMIN_CATEGORIES,
    SUPERADMIN_PRIORITIES,
} from './super-admin-notification.types';

export interface ISuperAdminPreferenceDocument extends ISuperAdminPreference, Document {
    _id: Types.ObjectId;
}

const superAdminPreferenceSchema = new Schema<ISuperAdminPreferenceDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        categories: {
            type: Map,
            of: Boolean,
            default: () => {
                const map = new Map<string, boolean>();
                for (const cat of SUPERADMIN_CATEGORIES) {
                    map.set(cat, true);
                }
                return map;
            },
        },
        minPriority: {
            type: String,
            enum: SUPERADMIN_PRIORITIES,
            default: 'LOW',
        },
        channels: {
            inApp: { type: Boolean, default: true },
            email: { type: Boolean, default: true },
            push: { type: Boolean, default: true },
        },
        allowDisableCriticalSecurity: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

export const SuperAdminNotificationPreference = model<ISuperAdminPreferenceDocument>(
    'SuperAdminNotificationPreference',
    superAdminPreferenceSchema
);
