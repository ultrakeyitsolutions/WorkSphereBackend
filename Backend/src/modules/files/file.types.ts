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
    companyId?: Types.ObjectId;
    uploadedBy: Types.ObjectId;
    originalName: string;
    storageKey: string;
    storageUrl: string;
    mimeType: string;
    extension: string;
    size: number;
    provider?: string;
    contextType: FileContextType;
    contextId?: Types.ObjectId | string;
    checksum?: string;
    resourceType?: 'image' | 'video' | 'raw';
    publicId?: string;
    processingStatus?: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'VALIDATING' | 'PROCESSING' | 'READY' | 'FAILED';
    deletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IFileDocument extends IFile, Document {}
