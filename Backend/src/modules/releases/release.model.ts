import { Schema, model } from 'mongoose';
import { IRelease, ReleaseStatus } from './release.types';

const releaseSchema = new Schema<IRelease>(
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
        version: {
            type: String,
            required: true,
            trim: true,
            maxlength: 50,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 3000,
            default: null,
        },
        startDate: {
            type: Date,
            default: null,
            index: true,
        },
        targetDate: {
            type: Date,
            required: true,
            index: true,
        },
        releasedAt: {
            type: Date,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(ReleaseStatus),
            default: ReleaseStatus.PLANNED,
            required: true,
            index: true,
        },
        releaseNotes: {
            type: String,
            trim: true,
            maxlength: 10000,
            default: null,
        },
        sprintIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Sprint',
            },
        ],
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

// Compound indexes for optimal release queries and uniqueness within a project
releaseSchema.index({ projectId: 1, version: 1 }, { unique: true });
releaseSchema.index({ projectId: 1, status: 1, targetDate: -1 });
releaseSchema.index({ companyId: 1, projectId: 1, createdAt: -1 });

export const Release = model<IRelease>('Release', releaseSchema);
export default Release;
