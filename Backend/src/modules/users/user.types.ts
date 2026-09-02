import { Document, Types } from 'mongoose';

export interface IUser {
    name: string;
    email: string;
    password?: string; // Opt out when resolving user details if not needed, but required in doc
    role: Types.ObjectId; // Reference to Role model
    companyId?: Types.ObjectId; // Reference to Company model (null for SUPER_ADMIN)
    mustChangePassword?: boolean;
    isActive: boolean;
    status: 'ACTIVE' | 'INACTIVE' | 'DEACTIVATED';
}

export interface IUserDocument extends IUser, Document {
    createdAt: Date;
    updatedAt: Date;
}
