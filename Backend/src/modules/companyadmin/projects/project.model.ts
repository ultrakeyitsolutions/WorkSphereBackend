import { Schema, model } from 'mongoose';
import {
    IProjectDocument,
    IProjectSettingsDocument,
    IProjectInChargeDocument,
    IProjectTeamMemberDocument,
    IProjectClientDocument,
    ProjectType,
    ProjectPriority,
    ProjectStatus,
} from './project.types';

// ─── Project Schema ───────────────────────────────────────────────────────────

const projectSchema = new Schema<IProjectDocument>(
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
            minlength: 2,
            maxlength: 150,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
        type: {
            type: String,
            enum: Object.values(ProjectType),
            required: true,
        },
        priority: {
            type: String,
            enum: Object.values(ProjectPriority),
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(ProjectStatus),
            default: ProjectStatus.ACTIVE,
            required: true,
            index: true,
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
        actualEndDate: {
            type: Date,
            default: null,
        },
        createdById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        isArchived: {
            type: Boolean,
            default: false,
        },
        isPinned: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// Compound indexes for common queries
projectSchema.index({ companyId: 1, status: 1 });
projectSchema.index({ companyId: 1, priority: 1 });
projectSchema.index({ companyId: 1, createdById: 1 });

export const Project = model<IProjectDocument>('Project', projectSchema);

// ─── Project Settings Schema ──────────────────────────────────────────────────

const projectSettingsSchema = new Schema<IProjectSettingsDocument>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            unique: true,
            index: true,
        },
        allowTeamMembersToCreateTasks: { type: Boolean, default: true },
        showTaskItemNumber: { type: Boolean, default: true },
        allowExplanation: { type: Boolean, default: true },
        deliveryDateMandatory: { type: Boolean, default: false },
        isConfidential: { type: Boolean, default: false },
        enableTemplateHierarchy: { type: Boolean, default: false },
        lastTaskItemNumber: { type: Number, default: 0 },
    },
    { timestamps: true }
);

export const ProjectSettings = model<IProjectSettingsDocument>(
    'ProjectSettings',
    projectSettingsSchema
);

// ─── Project In-Charge Schema ─────────────────────────────────────────────────

const projectInChargeSchema = new Schema<IProjectInChargeDocument>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        addedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        addedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    { timestamps: false }
);

// A user can only be in-charge of a project once
projectInChargeSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectInCharge = model<IProjectInChargeDocument>(
    'ProjectInCharge',
    projectInChargeSchema
);

// ─── Project Team Member Schema ───────────────────────────────────────────────

const projectTeamMemberSchema = new Schema<IProjectTeamMemberDocument>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        addedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        canCreateTasks: {
            type: Boolean,
            default: true,
        },
        addedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    { timestamps: false }
);

// A user can only be a member of a project once
projectTeamMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectTeamMember = model<IProjectTeamMemberDocument>(
    'ProjectTeamMember',
    projectTeamMemberSchema
);

// Reuse ProjectTeamMember as ProjectMember for chat/communication features
export const ProjectMember = ProjectTeamMember;

// ─── Project Client Schema ────────────────────────────────────────────────────

const projectClientSchema = new Schema<IProjectClientDocument>(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        addedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        addedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    { timestamps: false }
);

// A client can only be linked to a project once
projectClientSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectClient = model<IProjectClientDocument>(
    'ProjectClient',
    projectClientSchema
);
