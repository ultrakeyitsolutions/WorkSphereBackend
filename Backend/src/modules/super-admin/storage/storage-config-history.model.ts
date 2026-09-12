import { Schema, model } from 'mongoose';
import { IStorageConfigurationHistoryDocument } from './storage-config.types';

const storageConfigurationHistorySchema = new Schema<IStorageConfigurationHistoryDocument>(
    {
        configurationId: {
            type: Schema.Types.ObjectId,
            ref: 'StorageConfiguration',
            required: true,
            index: true,
        },
        provider: {
            type: String,
            required: true,
        },
        changedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        changedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        changedFields: {
            type: [String],
            default: [],
        },
        snapshot: {
            type: Schema.Types.Mixed,
            required: true,
        },
    },
    {
        timestamps: false,
    }
);

storageConfigurationHistorySchema.index({ changedAt: -1 });

export const StorageConfigurationHistory = model<IStorageConfigurationHistoryDocument>(
    'StorageConfigurationHistory',
    storageConfigurationHistorySchema
);
export default StorageConfigurationHistory;
