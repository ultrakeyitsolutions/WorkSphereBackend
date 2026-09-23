import { Schema, model } from 'mongoose';
import { INotificationSoundMapping } from './notification-sound.types';

const notificationSoundMappingSchema = new Schema<INotificationSoundMapping>(
    {
        notificationType: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        soundId: {
            type: String,
            default: null,
            trim: true,
            index: true,
        },
        isEnabled: {
            type: Boolean,
            default: true,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

export const NotificationSoundMapping = model<INotificationSoundMapping>(
    'NotificationSoundMapping',
    notificationSoundMappingSchema
);
