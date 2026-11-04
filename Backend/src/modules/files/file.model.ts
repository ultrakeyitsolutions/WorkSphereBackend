import { Schema, model } from 'mongoose';
import { IFileDocument } from './file.types';
import { CloudinaryStorageProvider } from '../../infrastructure/storage/providers/cloudinary-storage.provider';

const fileSchema = new Schema<IFileDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: false,
            index: true,
        },
        uploadedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        originalName: {
            type: String,
            required: true,
            trim: true,
        },
        storageKey: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        storageUrl: {
            type: String,
            required: true,
            trim: true,
        },
        mimeType: {
            type: String,
            required: true,
            trim: true,
        },
        extension: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        size: {
            type: Number,
            required: true,
        },
        provider: {
            type: String,
            required: false,
            index: true,
        },
        contextType: {
            type: String,
            enum: [
                'CHAT',
                'MESSAGE',
                'TASK',
                'PROJECT',
                'USER',
                'COMPANY',
                'DOCUMENT',
                'COMMENT',
                'OTHER',
            ],
            default: 'OTHER',
            required: true,
            index: true,
        },
        contextId: {
            type: Schema.Types.Mixed,
            default: null,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
        toJSON: { getters: true },
        toObject: { getters: true },
    }
);

// Compound indexes for optimal tenant and context queries
fileSchema.index({ companyId: 1, contextType: 1, contextId: 1 });
fileSchema.index({ companyId: 1, uploadedBy: 1 });
fileSchema.index({ companyId: 1, deletedAt: 1 });

// Ensure any Cloudinary URL references are converted to clean HTTPS delivery URLs
fileSchema.path('storageUrl').get((val: any) => {
    if (typeof val === 'string' && val.startsWith('cloudinary://')) {
        return CloudinaryStorageProvider.toHttpsDeliveryUrl(val);
    }
    return val;
});

fileSchema.path('storageUrl').set((val: any) => {
    if (typeof val === 'string' && val.startsWith('cloudinary://')) {
        return CloudinaryStorageProvider.toHttpsDeliveryUrl(val);
    }
    return val;
});

export const FileModel = model<IFileDocument>('File', fileSchema);
export default FileModel;
