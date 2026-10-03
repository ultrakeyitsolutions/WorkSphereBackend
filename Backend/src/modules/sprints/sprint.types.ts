import { Document, Types } from 'mongoose';

export enum SprintStatus {
    PLANNED = 'PLANNED',
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
}

export interface ISprint extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;

    name: string;
    description?: string | null;
    goal?: string | null;

    startDate: Date;
    endDate: Date;

    status: SprintStatus;

    createdBy: Types.ObjectId;
    updatedBy?: Types.ObjectId | null;

    createdAt: Date;
    updatedAt: Date;
}
