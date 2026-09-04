import { Schema, model, Document, Types } from 'mongoose';

export interface ITaskAssignment extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;

    assignedToId: Types.ObjectId;
    assignedToName: string;

    assignedById: Types.ObjectId;
    assignedAt: Date;

    isActive: boolean;
}

const taskAssignmentSchema = new Schema<ITaskAssignment>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },

        assignedToId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        assignedToName: { type: String, required: true },

        assignedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        assignedAt: { type: Date, default: Date.now },

        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

taskAssignmentSchema.index({ taskId: 1, isActive: 1 });

export const TaskAssignment = model<ITaskAssignment>('TaskAssignment', taskAssignmentSchema);
