import { Schema, model, Document, Types } from 'mongoose';

export interface ITaskTemplate extends Document {
    companyId: Types.ObjectId;
    name: string;
    description?: string;
    designationId?: Types.ObjectId;

    // Task defaults stored in template
    moduleId?: Types.ObjectId;
    priority?: string;
    taskType?: string;
    criticality?: string;
    estimatedTime?: { hours: number; minutes: number };
    tags?: string[];
    notes?: Array<{ content: string }>;
    checklist?: Array<{ title: string; isCompleted: boolean }>;

    isActive: boolean;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const taskTemplateSchema = new Schema<ITaskTemplate>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        designationId: { type: Schema.Types.ObjectId, ref: 'Designation' },

        moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },
        priority: { type: String },
        taskType: { type: String, default: 'TASK' },
        criticality: { type: String, default: 'NON_CRITICAL' },
        estimatedTime: {
            hours: { type: Number, default: 0 },
            minutes: { type: Number, default: 0 }
        },
        tags: [{ type: String }],
        notes: [{ content: { type: String, required: true } }],
        checklist: [
            {
                title: { type: String, required: true },
                isCompleted: { type: Boolean, default: false }
            }
        ],

        isActive: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
    },
    { timestamps: true }
);

taskTemplateSchema.index({ companyId: 1, isActive: 1 });

export const TaskTemplate = model<ITaskTemplate>('TaskTemplate', taskTemplateSchema);
