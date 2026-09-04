import { Schema, model, Document, Types } from 'mongoose';

export enum BugStatus {
    OPEN = 'OPEN',
    IN_PROGRESS = 'IN_PROGRESS',
    RESOLVED = 'RESOLVED',
    REOPENED = 'REOPENED',
    CLOSED = 'CLOSED'
}

export enum BugPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

export interface ITaskBug extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;
    createdBy: Types.ObjectId;
    title: string;
    description?: string;
    status: BugStatus;
    priority: BugPriority;
    assignedTo?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const taskBugSchema = new Schema<ITaskBug>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        status: { type: String, enum: Object.values(BugStatus), default: BugStatus.OPEN },
        priority: { type: String, enum: Object.values(BugPriority), default: BugPriority.LOW },
        assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

taskBugSchema.index({ taskId: 1, createdAt: -1 });

export const TaskBug = model<ITaskBug>('TaskBug', taskBugSchema);
export default TaskBug;
