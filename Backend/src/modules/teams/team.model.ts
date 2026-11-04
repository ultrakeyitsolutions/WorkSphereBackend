import { Schema, model } from 'mongoose';
import { ITeamDocument } from './team.types';

const teamSchema = new Schema<ITeamDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },
        code: {
            type: String,
            trim: true,
            uppercase: true,
            default: null,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
        departmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Designation',
            default: null,
            index: true,
        },
        departmentName: {
            type: String,
            trim: true,
            default: null,
        },
        leadId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        managerIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        memberIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        projectIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Project',
            },
        ],
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        isArchived: {
            type: Boolean,
            default: false,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
teamSchema.index({ companyId: 1, name: 1 }, { unique: true });
teamSchema.index({ companyId: 1, leadId: 1 });
teamSchema.index({ companyId: 1, managerIds: 1 });
teamSchema.index({ companyId: 1, memberIds: 1 });
teamSchema.index({ companyId: 1, projectIds: 1 });
teamSchema.index({ companyId: 1, isActive: 1, isArchived: 1 });

export const Team = model<ITeamDocument>('Team', teamSchema);
export default Team;
