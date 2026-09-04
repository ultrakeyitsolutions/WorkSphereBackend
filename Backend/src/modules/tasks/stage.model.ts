import { Schema, model, Document, Types } from 'mongoose';

export interface IStage extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    name: string;
    color?: string;
    orderIndex: number;
    isMaster: boolean;     // system-defined stage
    isDefault: boolean;    // auto-assigned on task creation
    isActive: boolean;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const stageSchema = new Schema<IStage>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        name: { type: String, required: true, trim: true },
        color: { type: String, default: '#6B7280' },
        orderIndex: { type: Number, default: 0 },
        isMaster: { type: Boolean, default: false },
        isDefault: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
    },
    { timestamps: true }
);

stageSchema.index({ projectId: 1, orderIndex: 1 });
stageSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const Stage = model<IStage>('Stage', stageSchema);
