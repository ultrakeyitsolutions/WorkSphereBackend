import { Schema, model, Document, Types } from 'mongoose';

export enum RecurrencePattern {
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    YEARLY = 'YEARLY'
}

export interface IRecurringRule extends Document {
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;
    moduleId?: Types.ObjectId;

    assignedToId?: Types.ObjectId;
    createdBy: Types.ObjectId;

    title: string;
    priority?: string;
    taskType?: string;
    criticality?: string;
    estimatedTime?: { hours: number; minutes: number };
    tags?: string[];

    notes?: Array<{ content: string }>;
    attachments?: Array<{
        fileName: string;
        fileUrl: string;
        fileType?: string;
        fileSize?: number;
        uploadedById?: Types.ObjectId;
    }>;
    checklist?: Array<{ title: string; isCompleted: boolean }>;

    pattern: RecurrencePattern | string;
    repeatEvery: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    month?: number;

    startDateTime: Date;
    endDateTime?: Date;
    maxOccurrences?: number;

    templateId?: Types.ObjectId;

    lastGeneratedAt?: Date;
    nextOccurrence?: Date;
    occurrenceCount: number;

    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const recurringRuleSchema = new Schema<IRecurringRule>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },

        assignedToId: { type: Schema.Types.ObjectId, ref: 'User' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

        title: { type: String, required: true, trim: true },
        priority: { type: String },
        taskType: { type: String },
        criticality: { type: String },
        estimatedTime: {
            hours: { type: Number, default: 0 },
            minutes: { type: Number, default: 0 }
        },
        tags: [{ type: String }],

        notes: [{ content: { type: String, required: true } }],
        attachments: [
            {
                fileName: { type: String, required: true },
                fileUrl: { type: String, required: true },
                fileType: { type: String },
                fileSize: { type: Number },
                uploadedById: { type: Schema.Types.ObjectId, ref: 'User' }
            }
        ],
        checklist: [
            {
                title: { type: String, required: true },
                isCompleted: { type: Boolean, default: false }
            }
        ],

        pattern: { type: String, enum: Object.values(RecurrencePattern), required: true },
        repeatEvery: { type: Number, default: 1 },
        daysOfWeek: [{ type: Number, min: 0, max: 6 }],
        dayOfMonth: { type: Number, min: 1, max: 31 },
        month: { type: Number, min: 1, max: 12 },

        startDateTime: { type: Date, required: true },
        endDateTime: { type: Date },
        maxOccurrences: { type: Number },

        templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate' },

        lastGeneratedAt: { type: Date },
        nextOccurrence: { type: Date },
        occurrenceCount: { type: Number, default: 0 },

        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

recurringRuleSchema.index({ projectId: 1, isActive: 1 });

export const RecurringRule = model<IRecurringRule>('RecurringRule', recurringRuleSchema);
