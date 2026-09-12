import { Schema, model } from 'mongoose';
import { IStorageConfigurationDocument } from './storage-config.types';

const defaultLimits = {
    imageMaxSizeMB: 15,
    documentMaxSizeMB: 30,
    audioMaxSizeMB: 30,
    videoMaxSizeMB: 100,
};

const defaultAllowedTypes = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt'],
    audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
    video: ['mp4', 'mov', 'webm'],
};

const storageConfigurationSchema = new Schema<IStorageConfigurationDocument>(
    {
        provider: {
            type: String,
            enum: ['BUNNY', 'S3', 'CLOUDFLARE_R2', 'CLOUDINARY', 'OTHER'],
            default: 'BUNNY',
            required: true,
            index: true,
        },
        enabled: {
            type: Boolean,
            default: true,
            required: true,
            index: true,
        },
        configuration: {
            type: Schema.Types.Mixed,
            required: true,
            default: {},
        },
        limits: {
            imageMaxSizeMB: { type: Number, default: defaultLimits.imageMaxSizeMB },
            documentMaxSizeMB: { type: Number, default: defaultLimits.documentMaxSizeMB },
            audioMaxSizeMB: { type: Number, default: defaultLimits.audioMaxSizeMB },
            videoMaxSizeMB: { type: Number, default: defaultLimits.videoMaxSizeMB },
        },
        allowedTypes: {
            image: { type: [String], default: defaultAllowedTypes.image },
            document: { type: [String], default: defaultAllowedTypes.document },
            audio: { type: [String], default: defaultAllowedTypes.audio },
            video: { type: [String], default: defaultAllowedTypes.video },
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

export const StorageConfiguration = model<IStorageConfigurationDocument>(
    'StorageConfiguration',
    storageConfigurationSchema
);
export default StorageConfiguration;
