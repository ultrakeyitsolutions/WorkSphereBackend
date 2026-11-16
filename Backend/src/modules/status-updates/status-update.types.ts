import { Document, Types } from 'mongoose';

export type StatusCategory = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'BLOCKED';

export interface IStatusUpdateFeedback {
    _id?: Types.ObjectId;
    comment: string;
    authorId: Types.ObjectId | any;
    authorRole?: string;
    createdAt: Date;
}

export interface IStatusUpdateDocument extends Document {
    companyId: Types.ObjectId;
    employeeId: Types.ObjectId;
    date: string; // YYYY-MM-DD
    statusCategory: StatusCategory;
    todayWork: string;
    currentWork?: string;
    nextWork?: string;
    blockers?: string;
    additionalComments?: string;
    associatedProjects: Types.ObjectId[];
    associatedTasks: Types.ObjectId[];
    feedback: IStatusUpdateFeedback[];
    isEdited: boolean;
    lastEditedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateStatusUpdateDto {
    date?: string;
    statusCategory?: StatusCategory;
    todayWork: string;
    currentWork?: string;
    nextWork?: string;
    blockers?: string;
    additionalComments?: string;
    associatedProjects?: string[];
    associatedTasks?: string[];
}

export interface UpdateStatusUpdateDto {
    statusCategory?: StatusCategory;
    todayWork?: string;
    currentWork?: string;
    nextWork?: string;
    blockers?: string;
    additionalComments?: string;
    associatedProjects?: string[];
    associatedTasks?: string[];
}

export interface AddFeedbackDto {
    comment: string;
}

export interface StatusUpdateFilterQuery {
    date?: string;
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    teamId?: string;
    projectId?: string;
    statusCategory?: StatusCategory;
    hasBlockers?: boolean | string;
    search?: string;
    page?: number | string;
    limit?: number | string;
}

