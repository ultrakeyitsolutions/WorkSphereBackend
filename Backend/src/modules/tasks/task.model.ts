import { Schema, model, Document, Types } from 'mongoose';

export enum TaskPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT'
}

export enum TaskType {
    TASK = 'TASK',
    BUG = 'BUG',
    STORY = 'STORY'
}

export enum TaskCriticality {
    NON_CRITICAL = 'NON_CRITICAL',
    CRITICAL = 'CRITICAL'
}

export interface IChecklistItem {
    title: string;
    isCompleted: boolean;
    completedById?: Types.ObjectId;
    completedAt?: Date;
    notes?: string;
}

export interface ITask extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    moduleId?: Types.ObjectId;
    sprintId?: Types.ObjectId | null;
    releaseId?: Types.ObjectId | null;

    title: string;

    itemNumber?: number;
    taskNumber?: string;
    ticketId?: string;

    statusId?: Types.ObjectId;
    stageId?: Types.ObjectId;

    priority: TaskPriority;
    taskType: string;
    criticality: TaskCriticality;

    startDate?: Date;
    endDate?: Date;
    dueDate?: Date;
    deliveryDate?: Date;

    estimatedTime?: { hours: number; minutes: number };
    actualHours?: number;
    progress?: number;

    assignedToId?: Types.ObjectId;
    createdBy: Types.ObjectId;

    tags?: string[];

    notes?: Array<{ content: string }>;

    attachments?: Array<{
        fileName: string;
        fileUrl: string;
        fileType?: string;
        fileSize?: number;
        uploadedById?: Types.ObjectId;
    }>;

    checklist?: IChecklistItem[];

    isUseTemplate: boolean;
    templateId?: Types.ObjectId;

    isRecurring: boolean;
    recurringRuleId?: Types.ObjectId;

    // Reopen tracking
    isReopen: boolean;
    reopenedFromTaskId?: Types.ObjectId;
    reopenedFromTaskNumber?: string;
    reopenReason?: string;
    completedDate?: Date;

    isPinned: boolean;
    isActive: boolean;
    isArchived: boolean;

    orderIndex?: number;

    createdAt: Date;
    updatedAt: Date;
}

const checklistItemSchema = new Schema<IChecklistItem>(
    {
        title: { type: String, required: true },
        isCompleted: { type: Boolean, default: false },
        completedById: { type: Schema.Types.ObjectId, ref: 'User' },
        completedAt: { type: Date },
        notes: { type: String, default: null }
    },
    { _id: true }
);

const taskSchema = new Schema<ITask>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },
        sprintId: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
        releaseId: { type: Schema.Types.ObjectId, ref: 'Release', default: null },

        title: { type: String, required: true, trim: true },

        itemNumber: { type: Number },
        taskNumber: { type: String },
        ticketId: { type: String },

        statusId: { type: Schema.Types.ObjectId, ref: 'Status' },
        stageId: { type: Schema.Types.ObjectId, ref: 'Stage' },

        priority: { type: String, enum: Object.values(TaskPriority), default: TaskPriority.MEDIUM },
        taskType: { type: String, default: TaskType.TASK },
        criticality: { type: String, enum: Object.values(TaskCriticality), default: TaskCriticality.NON_CRITICAL },

        startDate: { type: Date },
        endDate: { type: Date },
        dueDate: { type: Date },
        deliveryDate: { type: Date },

        estimatedTime: {
            hours: { type: Number, default: 0 },
            minutes: { type: Number, default: 0 }
        },
        actualHours: { type: Number, default: 0 },
        progress: { type: Number, default: 0, min: 0, max: 100 },

        assignedToId: { type: Schema.Types.ObjectId, ref: 'User' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

        tags: [{ type: String }],

        notes: [
            {
                content: { type: String, required: true }
            }
        ],

        attachments: [
            {
                fileName: { type: String, required: true },
                fileUrl: { type: String, required: true },
                fileType: { type: String },
                fileSize: { type: Number },
                uploadedById: { type: Schema.Types.ObjectId, ref: 'User' }
            }
        ],

        checklist: [checklistItemSchema],

        isUseTemplate: { type: Boolean, default: false },
        templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate' },

        isRecurring: { type: Boolean, default: false },
        recurringRuleId: { type: Schema.Types.ObjectId, ref: 'RecurringRule' },

        // Reopen tracking
        isReopen: { type: Boolean, default: false },
        reopenedFromTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
        reopenedFromTaskNumber: { type: String },
        reopenReason: { type: String, trim: true },
        completedDate: { type: Date },

        isPinned: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        isArchived: { type: Boolean, default: false },

        orderIndex: { type: Number, default: 0 }
    },
    { timestamps: true }
);

taskSchema.index({ projectId: 1, itemNumber: 1 });
taskSchema.index({ companyId: 1, projectId: 1, isArchived: 1 });
taskSchema.index({ companyId: 1, isArchived: 1 });
taskSchema.index({ companyId: 1, assignedToId: 1, statusId: 1 });
taskSchema.index({ companyId: 1, assignedToId: 1, createdAt: 1 });
taskSchema.index({ projectId: 1, sprintId: 1 });
taskSchema.index({ projectId: 1, releaseId: 1 });

export const Task = model<ITask>('Task', taskSchema);
