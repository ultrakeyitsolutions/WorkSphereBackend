import { Document, Schema } from 'mongoose';

export interface IRole {
    name: string; // e.g. "Admin", "User", "Manager"
    permissions: Schema.Types.ObjectId[]; // References to Permission model
}

export interface IRoleDocument extends IRole, Document {
    createdAt: Date;
    updatedAt: Date;
}
