import { Document, Types } from 'mongoose';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ProjectType {
    NEW = 'New',
    ONGOING = 'Ongoing',
    MAINTENANCE = 'Maintenance',
    UPGRADE = 'Upgrade',
    INTERNAL = 'Internal',
}

export enum ProjectPriority {
    LOW = 'Low',
    MEDIUM = 'Medium',
    HIGH = 'High',
    CRITICAL = 'Critical',
}

export enum ProjectStatus {
    ACTIVE = 'Active',
    ON_HOLD = 'OnHold',
    COMPLETED = 'Completed',
    CANCELLED = 'Cancelled',
    ARCHIVED = 'Archived',
}

// ─── Core Project ─────────────────────────────────────────────────────────────

export interface IProject {
    companyId: Types.ObjectId;
    name: string;
    description?: string;
    type: ProjectType;
    priority: ProjectPriority;
    status: ProjectStatus;
    startDate: Date;
    endDate: Date;
    actualEndDate?: Date | null;
    createdById: Types.ObjectId;
    isActive: boolean;
    isArchived: boolean;
    isPinned: boolean;
    deletedAt?: Date | null;
}

export interface IProjectDocument extends IProject, Document { }

// ─── Project Settings ─────────────────────────────────────────────────────────

export interface IProjectSettings {
    projectId: Types.ObjectId;
    allowTeamMembersToCreateTasks: boolean;
    showTaskItemNumber: boolean;
    allowExplanation: boolean;
    deliveryDateMandatory: boolean;
    isConfidential: boolean;
    enableTemplateHierarchy: boolean;
}

export interface IProjectSettingsDocument extends IProjectSettings, Document { }

// ─── Project In-Charge ────────────────────────────────────────────────────────

export interface IProjectInCharge {
    projectId: Types.ObjectId;
    userId: Types.ObjectId;
    addedById: Types.ObjectId;
    addedAt: Date;
}

export interface IProjectInChargeDocument extends IProjectInCharge, Document { }

// ─── Project Team Member ──────────────────────────────────────────────────────

export interface IProjectTeamMember {
    projectId: Types.ObjectId;
    userId: Types.ObjectId;
    addedById: Types.ObjectId;
    canCreateTasks: boolean;
    addedAt: Date;
}

export interface IProjectTeamMemberDocument extends IProjectTeamMember, Document { }

// ─── Project Client ───────────────────────────────────────────────────────────

export interface IProjectClient {
    projectId: Types.ObjectId;
    userId: Types.ObjectId;
    addedById: Types.ObjectId;
    addedAt: Date;
}

export interface IProjectClientDocument extends IProjectClient, Document { }
