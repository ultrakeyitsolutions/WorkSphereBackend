import { Schema, model, Document, Types } from 'mongoose';

export interface ITaskReaction extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    taskId: Types.ObjectId;
    activityId: Types.ObjectId;
    userId: Types.ObjectId;
    reaction: string;
    createdAt: Date;
    updatedAt: Date;
}

const taskReactionSchema = new Schema<ITaskReaction>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
        activityId: { type: Schema.Types.ObjectId, ref: 'TaskActivity', required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        reaction: { type: String, required: true },
    },
    { timestamps: true }
);

taskReactionSchema.index({ activityId: 1 });
taskReactionSchema.index({ activityId: 1, userId: 1, reaction: 1 }, { unique: true });

export const TaskReaction = model<ITaskReaction>('TaskReaction', taskReactionSchema);
export default TaskReaction;
