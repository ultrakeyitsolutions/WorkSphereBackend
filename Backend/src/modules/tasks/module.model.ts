import { Schema, model, Document, Types } from 'mongoose';

export interface IModule extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    name: string;
    description?: string;
    orderIndex: number;
    isActive: boolean;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const moduleSchema = new Schema<IModule>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        orderIndex: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
    },
    { timestamps: true }
);

moduleSchema.index({ projectId: 1, isActive: 1 });
moduleSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const Module = model<IModule>('Module', moduleSchema);
