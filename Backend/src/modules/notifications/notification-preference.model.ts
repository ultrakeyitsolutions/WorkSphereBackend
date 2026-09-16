import { Schema, model, Document, Types } from 'mongoose';
import { NotificationType } from './notification.types';

// ─── NotificationPreference Document ─────────────────────────────────────────

export interface INotificationPreference extends Document {
    companyId: Types.ObjectId;
    notificationType: NotificationType;
    enabled: boolean;
    channels: {
        inApp: boolean;
        push: boolean;
        email: boolean;
    };
    style: string;
    icon?: string;
    template: {
        title: string;
        message: string;
    };
    /** Configurable retention in days (overrides global default) */
    retentionDays: number;
    createdAt: Date;
    updatedAt: Date;
}

const notificationPreferenceSchema = new Schema<INotificationPreference>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
        notificationType: { type: String, required: true },
        enabled: { type: Boolean, default: true },
        channels: {
            inApp: { type: Boolean, default: true },
            push: { type: Boolean, default: false },
            email: { type: Boolean, default: false },
        },
        style: { type: String, default: 'INFO' },
        icon: { type: String, default: 'bell' },
        template: {
            title: { type: String, required: true },
            message: { type: String, required: true },
        },
        retentionDays: { type: Number, default: 90, min: 1, max: 365 },
    },
    { timestamps: true }
);

// One preference record per company per notification type
notificationPreferenceSchema.index(
    { companyId: 1, notificationType: 1 },
    { unique: true }
);

notificationPreferenceSchema.index({ companyId: 1 });

export const NotificationPreference = model<INotificationPreference>(
    'NotificationPreference',
    notificationPreferenceSchema
);
