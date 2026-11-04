import { Document, Types } from 'mongoose';

export interface ITeam {
    companyId: Types.ObjectId;
    name: string;
    code?: string;
    description?: string;
    departmentId?: Types.ObjectId | null;
    departmentName?: string | null;
    leadId?: Types.ObjectId | null; // Primary team manager/lead
    managerIds?: Types.ObjectId[]; // All assigned managers
    memberIds: Types.ObjectId[];
    projectIds: Types.ObjectId[];
    isActive: boolean;
    isArchived: boolean;
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ITeamDocument extends ITeam, Document {}

export interface CreateTeamDto {
    name: string;
    code?: string;
    description?: string;
    departmentId?: string;
    departmentName?: string;
    leadId?: string;
    managerIds?: string[];
    memberIds?: string[];
    projectIds?: string[];
}

export interface UpdateTeamDto {
    name?: string;
    code?: string;
    description?: string;
    departmentId?: string;
    departmentName?: string;
    leadId?: string;
    managerIds?: string[];
    memberIds?: string[];
    projectIds?: string[];
    isActive?: boolean;
    isArchived?: boolean;
}
