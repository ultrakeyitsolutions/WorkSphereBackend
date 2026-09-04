import { Schema, model, Document, Types } from 'mongoose';

export interface IStatus extends Document {
    companyId: Types.ObjectId;
    name: string;
    color?: string;
    orderIndex: number;
    isMaster: boolean;
    isActive: boolean;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const statusSchema = new Schema<IStatus>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        name: { type: String, required: true, trim: true },
        color: { type: String, default: '#6B7280' },
        orderIndex: { type: Number, default: 0 },
        isMaster: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
    },
    { timestamps: true }
);

statusSchema.index({ companyId: 1, isActive: 1 });
statusSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const Status = model<IStatus>('Status', statusSchema);
