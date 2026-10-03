import { Schema, model } from 'mongoose';
import { ISprint, SprintStatus } from './sprint.types';

const sprintSchema = new Schema<ISprint>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 3000,
            default: null,
        },
        goal: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
        startDate: {
            type: Date,
            required: true,
            index: true,
        },
        endDate: {
            type: Date,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(SprintStatus),
            default: SprintStatus.PLANNED,
            required: true,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

// Compound indexes for optimal sprint queries
sprintSchema.index({ projectId: 1, status: 1, startDate: -1 });
sprintSchema.index({ companyId: 1, projectId: 1, createdAt: -1 });

export const Sprint = model<ISprint>('Sprint', sprintSchema);
export default Sprint;
