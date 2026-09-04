import { Schema, model, Document, Types } from 'mongoose';

export enum AttachmentType {
    IMAGE = 'IMAGE',
    DOCUMENT = 'DOCUMENT',
    VIDEO = 'VIDEO',
    AUDIO = 'AUDIO',
    OTHER = 'OTHER'
}

export interface ITaskAttachment extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;
    activityId?: Types.ObjectId;
    bugId?: Types.ObjectId;
    uploadedBy: Types.ObjectId;
    fileName: string;
    originalName: string;
    storageKey: string;
    url: string;
    mimeType: string;
    size: number;
    type: AttachmentType;
    createdAt: Date;
    updatedAt: Date;
}

const taskAttachmentSchema = new Schema<ITaskAttachment>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
        activityId: { type: Schema.Types.ObjectId, ref: 'TaskActivity', default: null },
        bugId: { type: Schema.Types.ObjectId, ref: 'TaskBug', default: null },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        fileName: { type: String, required: true },
        originalName: { type: String, required: true },
        storageKey: { type: String, required: true },
        url: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        type: { type: String, enum: Object.values(AttachmentType), default: AttachmentType.OTHER },
    },
    { timestamps: true }
);

taskAttachmentSchema.index({ taskId: 1, createdAt: -1 });
taskAttachmentSchema.index({ activityId: 1 });
taskAttachmentSchema.index({ bugId: 1 });

export const TaskAttachment = model<ITaskAttachment>('TaskAttachment', taskAttachmentSchema);
export default TaskAttachment;
