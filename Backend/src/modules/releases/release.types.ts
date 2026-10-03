import { Document, Types } from 'mongoose';

export enum ReleaseStatus {
    PLANNED = 'PLANNED',
    IN_PROGRESS = 'IN_PROGRESS',
    RELEASED = 'RELEASED',
    CANCELLED = 'CANCELLED',
}

export interface IRelease extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;

    name: string;
    version: string;
    description?: string | null;

    startDate?: Date | null;
    targetDate: Date;
    releasedAt?: Date | null;

    status: ReleaseStatus;
    releaseNotes?: string | null;

    sprintIds?: Types.ObjectId[];

    createdBy: Types.ObjectId;
    updatedBy?: Types.ObjectId | null;

    createdAt: Date;
    updatedAt: Date;
}
