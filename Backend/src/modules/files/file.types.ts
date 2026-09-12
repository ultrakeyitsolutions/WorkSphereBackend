import { Document, Types } from 'mongoose';

export type FileContextType =
    | 'CHAT'
    | 'MESSAGE'
    | 'TASK'
    | 'PROJECT'
    | 'USER'
    | 'COMPANY'
    | 'DOCUMENT'
    | 'COMMENT'
    | 'OTHER';

export interface IFile {
    companyId: Types.ObjectId;
    uploadedBy: Types.ObjectId;
    originalName: string;
    storageKey: string;
    storageUrl: string;
    mimeType: string;
    extension: string;
    size: number;
    contextType: FileContextType;
    contextId?: Types.ObjectId | string;
    deletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IFileDocument extends IFile, Document {}
