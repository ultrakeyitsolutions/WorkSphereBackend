import { Document, Types } from 'mongoose';

export enum ReleaseStatus {
    PLANNED = 'PLANNED',
    IN_PROGRESS = 'IN_PROGRESS',
    READY_TO_SHIP = 'READY_TO_SHIP',
    RELEASED = 'RELEASED',
    CANCELLED = 'CANCELLED',
}

export interface IReleaseTaskSnapshot {
    totalTasks: number;
    completedTasks: number;
    completionPercentage: number;
    taskIds?: Types.ObjectId[];
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
    releasedBy?: Types.ObjectId | null;

    status: ReleaseStatus;
    releaseNotes?: string | null;

    sprintIds?: Types.ObjectId[];
    taskSnapshot?: IReleaseTaskSnapshot | null;

    createdBy: Types.ObjectId;
    updatedBy?: Types.ObjectId | null;

    createdAt: Date;
    updatedAt: Date;
}

