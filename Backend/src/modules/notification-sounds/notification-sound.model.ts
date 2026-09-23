import { Schema, model } from 'mongoose';
import { INotificationSound } from './notification-sound.types';

const notificationSoundSchema = new Schema<INotificationSound>(
    {
        soundId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        fileUrl: {
            type: String,
            required: true,
            trim: true,
        },
        storageKey: {
            type: String,
            required: true,
            trim: true,
        },
        mimeType: {
            type: String,
            required: true,
            trim: true,
        },
        fileSize: {
            type: Number,
            required: true,
            min: 0,
        },
        durationMs: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        isDefault: {
            type: Boolean,
            default: false,
            index: true,
        },
        platformSounds: {
            web: { type: String, default: undefined },
            android: { type: String, default: undefined },
            ios: { type: String, default: undefined },
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
        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound and auxiliary indexes
notificationSoundSchema.index({ deletedAt: 1, isActive: 1 });

export const NotificationSound = model<INotificationSound>(
    'NotificationSound',
    notificationSoundSchema
);
