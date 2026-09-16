import { Schema, model, Document, Types } from 'mongoose';

export enum ActivityType {
    COMMENT = 'COMMENT',
    DOUBT = 'DOUBT',
    SYSTEM = 'SYSTEM',
    TASK_STARTED = 'TASK_STARTED',
    TASK_PAUSED = 'TASK_PAUSED',
    TASK_RESUMED = 'TASK_RESUMED',
    TASK_HELD = 'TASK_HELD',
    TASK_COMPLETED = 'TASK_COMPLETED',
    TASK_CANCELLED = 'TASK_CANCELLED'
}

export interface ITaskActivity extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;
    userId: Types.ObjectId;
    type: ActivityType;
    content?: string;
    parentId?: Types.ObjectId; // For replies
    audio?: {
        url: string;
        storageKey: string;
        duration: number;
        mimeType: string;
        size: number;
    };
    video?: {
        url: string;
        storageKey: string;
        duration: number;
        mimeType: string;
        size: number;
    };
    isResolved?: boolean;
    routedToRole?: string;
    routedToUserId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const taskActivitySchema = new Schema<ITaskActivity>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: { type: String, enum: Object.values(ActivityType), required: true },
        content: { type: String, trim: true },
        parentId: { type: Schema.Types.ObjectId, ref: 'TaskActivity', default: null },
        audio: {
            url: { type: String },
            storageKey: { type: String },
            duration: { type: Number },
            mimeType: { type: String },
            size: { type: Number }
        },
        video: {
            url: { type: String },
            storageKey: { type: String },
            duration: { type: Number },
            mimeType: { type: String },
            size: { type: Number }
        },
        isResolved: { type: Boolean, default: false },
        routedToRole: { type: String },
        routedToUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

taskActivitySchema.index({ taskId: 1, createdAt: -1 });
taskActivitySchema.index({ parentId: 1 });
taskActivitySchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export const TaskActivity = model<ITaskActivity>('TaskActivity', taskActivitySchema);
export default TaskActivity;
