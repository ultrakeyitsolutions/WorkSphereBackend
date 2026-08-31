import { Document, Schema } from 'mongoose';

export interface IUser {
    name: string;
    email: string;
    password?: string; // Opt out when resolving user details if not needed, but required in doc
    role: Schema.Types.ObjectId; // Reference to Role model
    isActive: boolean;
    status: 'ACTIVE' | 'INACTIVE' | 'DEACTIVATED';
}

export interface IUserDocument extends IUser, Document {
    createdAt: Date;
    updatedAt: Date;
}
