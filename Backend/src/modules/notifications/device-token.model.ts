import { Schema, model, Document, Types } from 'mongoose';

export interface IDeviceToken extends Document {
    userId: Types.ObjectId;
    companyId: Types.ObjectId;
    pushToken: string;
    platform: 'ios' | 'android' | 'web';
    deviceId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        pushToken: { type: String, required: true },
        platform: { type: String, enum: ['ios', 'android', 'web'], default: 'android' },
        deviceId: { type: String, default: null },
    },
    { timestamps: true }
);

deviceTokenSchema.index({ userId: 1, pushToken: 1 }, { unique: true });

export const DeviceToken = model<IDeviceToken>('DeviceToken', deviceTokenSchema);
