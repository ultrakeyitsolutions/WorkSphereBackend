import { Schema, model } from 'mongoose';
import { IFileDocument } from './file.types';

const fileSchema = new Schema<IFileDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
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
    }
);

// Compound indexes for optimal tenant and context queries
fileSchema.index({ companyId: 1, contextType: 1, contextId: 1 });
fileSchema.index({ companyId: 1, uploadedBy: 1 });
fileSchema.index({ companyId: 1, deletedAt: 1 });

export const FileModel = model<IFileDocument>('File', fileSchema);
export default FileModel;
