import { Schema, model, Document, Types } from 'mongoose';

export enum RecurrenceType {
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    YEARLY = 'YEARLY'
}

export interface IRecurringRule extends Document {
    projectId: Types.ObjectId;
    moduleId?: Types.ObjectId;
    createdBy: Types.ObjectId;
    assignedToId?: Types.ObjectId;

    title: string;
    description?: string;

    type: RecurrenceType;
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;

    startDate: Date;
    endDate?: Date;
    maxOccurrences?: number;

    useSpecificTime: boolean;
    startTime?: string;
    endTime?: string;

    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const recurringRuleSchema = new Schema<IRecurringRule>(
    {
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
        moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        assignedToId: { type: Schema.Types.ObjectId, ref: 'User' },

        title: { type: String, required: true },
        description: { type: String },

        type: { type: String, enum: Object.values(RecurrenceType), required: true },
        interval: { type: Number, default: 1 },
        daysOfWeek: { type: [Number] },
        dayOfMonth: { type: Number },

        startDate: { type: Date, required: true },
        endDate: { type: Date },
        maxOccurrences: { type: Number },

        useSpecificTime: { type: Boolean, default: false },
        startTime: { type: String },
        endTime: { type: String },

        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

export const RecurringRule = model<IRecurringRule>('RecurringRule', recurringRuleSchema);
