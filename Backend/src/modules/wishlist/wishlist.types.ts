import { Document, Types } from 'mongoose';

export enum WishlistStatus {
    IDEA = 'IDEA',
    UNDER_REVIEW = 'UNDER_REVIEW',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    CONVERTED = 'CONVERTED',
}

export enum WishlistPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT',
}

export interface IWishlist extends Document {
    _id: Types.ObjectId;
    companyId: Types.ObjectId;
    projectId: Types.ObjectId;

    title: string;
    description?: string | null;

    status: WishlistStatus;
    priority: WishlistPriority;

    tags?: string[];

    convertedToTaskId?: Types.ObjectId | null;

    createdBy: Types.ObjectId;
    updatedBy?: Types.ObjectId | null;

    createdAt: Date;
    updatedAt: Date;
}
