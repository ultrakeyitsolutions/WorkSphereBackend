import { Document } from 'mongoose';

export interface IPermission {
    name: string; // e.g. "READ_USERS", "WRITE_USERS"
    description?: string;
    category?: string; // e.g. "PROJECTS", "COMPANY_MANAGEMENT"
    scope?: 'COMPANY_MEMBER' | 'SYSTEM';
    assignableBy?: string[]; // e.g. ["COMPANY_ADMIN", "SUPER_ADMIN"]
}

export interface IPermissionDocument extends IPermission, Document {
    createdAt: Date;
    updatedAt: Date;
}
