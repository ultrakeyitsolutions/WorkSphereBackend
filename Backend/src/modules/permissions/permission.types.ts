import { Document } from 'mongoose';

export interface IPermission {
    name: string; // e.g. "READ_USERS", "WRITE_USERS"
    description?: string;
}

export interface IPermissionDocument extends IPermission, Document {
    createdAt: Date;
    updatedAt: Date;
}
