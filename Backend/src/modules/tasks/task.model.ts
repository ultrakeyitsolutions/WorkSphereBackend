import { Schema, model, Document, Types } from 'mongoose';

export enum TaskPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT'
}

export interface ITask extends Document {
    projectId: Types.ObjectId;
    moduleId?: Types.ObjectId;

    title: string;
    description?: string;

    itemNumber: number;
    ticketId?: string;

    createdBy: Types.ObjectId;
    assignedToId?: Types.ObjectId;

    stageId?: Types.ObjectId;
    priority: TaskPriority;
    criticality?: number;

    startDate?: Date;
    deliveryDate?: Date;

    estimatedHours?: number;
    actualHours?: number;
    progress?: number;

    tags?: string[];

    isRecurring: boolean;
    recurringRuleId?: Types.ObjectId;

    isActive: boolean;
    isArchived: boolean;

    createdAt: Date;
    updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
    {
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },

        title: { type: String, required: true },
        description: { type: String },

        itemNumber: { type: Number },
        ticketId: { type: String },

        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        assignedToId: { type: Schema.Types.ObjectId, ref: 'User' },

        stageId: { type: Schema.Types.ObjectId, ref: 'Stage' },
        priority: { type: String, enum: Object.values(TaskPriority), default: TaskPriority.MEDIUM },
        criticality: { type: Number, default: 2 },

        startDate: { type: Date },
        deliveryDate: { type: Date },

        estimatedHours: { type: Number, default: 0 },
        actualHours: { type: Number, default: 0 },
        progress: { type: Number, default: 0 },

        tags: [{ type: String }],

        isRecurring: { type: Boolean, default: false },
        recurringRuleId: { type: Schema.Types.ObjectId, ref: 'RecurringRule' },

        isActive: { type: Boolean, default: true },
        isArchived: { type: Boolean, default: false }
    },
    { timestamps: true }
);

taskSchema.index({ projectId: 1, itemNumber: 1 });

export const Task = model<ITask>('Task', taskSchema);
