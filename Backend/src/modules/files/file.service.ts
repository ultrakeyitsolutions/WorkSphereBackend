import crypto from 'crypto';
import { Types } from 'mongoose';
import { FileModel } from './file.model';
import { IFileDocument, FileContextType } from './file.types';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../../infrastructure/storage/storage-provider.factory';
import { validateUploadedFile } from './file.validator';
import { ChatService } from '../chat/chat.service';
import { ProjectService } from '../companyadmin/projects/project.service';

export interface UploadOptions {
    file: Express.Multer.File;
    companyId: string;
    userId: string;
    contextType: FileContextType;
    contextId?: string;
    folder?: string;
}

export class FileService {
    /**
     * Upload a file using the dynamically resolved active storage provider.
     */
    static async upload(options: UploadOptions): Promise<IFileDocument> {
        const { file, companyId, userId, contextType, contextId, folder } = options;

        if (!file || !file.buffer) {
            throw new Error('No file provided or file buffer is empty.');
        }

        // 1. Get active storage configuration
        const activeConfig = await StorageConfigurationService.getActiveConfiguration();
        if (!activeConfig || !activeConfig.enabled) {
            throw new Error('File storage service is currently disabled or unconfigured.');
        }

        // 2. Validate file against dynamic limits and allowed types
        const validation = validateUploadedFile(
            file.originalname,
            file.mimetype,
            file.size,
            activeConfig.limits,
            activeConfig.allowedTypes
        );

        if (!validation.valid) {
            const error: any = new Error(validation.error || 'Invalid files.');
            error.statusCode = 400;
            error.details = {
                category: validation.category,
                limitMB: validation.limitMB,
                currentSizeMB: validation.currentSizeMB,
            };
            throw error;
        }

        // 3. Generate structured storage key
        const basePath = (activeConfig.configuration?.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
        const targetFolder = folder
            ? folder.replace(/^\/+|\/+$/g, '')
            : `${contextType.toLowerCase()}s`;
        const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const storageKey = `${basePath}/companies/${companyId}/${targetFolder}/${uniquePrefix}-${sanitizedOriginal}`;

        // 4. Resolve active storage provider
        const provider = StorageProviderFactory.createProvider(
            activeConfig.provider,
            activeConfig.configuration
        );

        // 5. Upload to storage provider
        let uploadResult;
        try {
            uploadResult = await provider.uploadFile(file.buffer, storageKey, file.mimetype);
        } catch (uploadError: any) {
            console.error('[FileService] Storage provider upload failed:', uploadError);
            throw new Error(`Failed to upload file to storage: ${uploadError.message}`);
        }

        // 6. Extract extension
        const extension = file.originalname.split('.').pop()?.toLowerCase() || '';

        // 7. Persist metadata in MongoDB with rollback on failure
        try {
            const fileDoc = await FileModel.create({
                companyId: new Types.ObjectId(companyId),
                uploadedBy: new Types.ObjectId(userId),
                originalName: file.originalname,
                storageKey: uploadResult.storageKey,
                storageUrl: uploadResult.storageUrl,
                mimeType: file.mimetype,
                extension,
                size: file.size,
                contextType,
                contextId: (contextId ? (Types.ObjectId.isValid(contextId) ? new Types.ObjectId(contextId) : contextId) : undefined) as any,
            });

            return fileDoc;
        } catch (dbError: any) {
            console.error('[FileService] MongoDB file record creation failed. Rolling back storage file:', dbError);
            // Rollback uploaded file from storage provider to prevent orphaned files
            await provider.deleteFile(storageKey).catch((delErr) => {
                console.error('[FileService] Failed to clean up orphaned storage file:', delErr);
            });
            throw new Error('Database record creation failed. File upload rolled back.');
        }
    }

    /**
     * Retrieve file with strict multi-tenant and context-aware authorization.
     */
    static async getAuthorizedFile(fileId: string, user: { userId: string; companyId?: string; role: string }): Promise<IFileDocument> {
        if (!Types.ObjectId.isValid(fileId)) {
            throw new Error('INVALID_FILE_ID');
        }

        const file = await FileModel.findOne({ _id: fileId, deletedAt: null });
        if (!file) {
            throw new Error('FILE_NOT_FOUND');
        }

        // Super Admin has global read access
        if (user.role === 'SUPER_ADMIN') {
            return file;
        }

        // Company isolation check
        if (!user.companyId || file.companyId.toString() !== user.companyId.toString()) {
            throw new Error('FORBIDDEN_COMPANY');
        }

        // Context-aware authorization
        if (file.contextType === 'CHAT' || file.contextType === 'MESSAGE') {
            // Requester must be an active participant of the conversation
            if (file.contextId) {
                const isParticipant = await ChatService.isParticipant(
                    file.contextId.toString(),
                    user.userId
                );
                if (!isParticipant) {
                    throw new Error('FORBIDDEN_CONVERSATION');
                }
            }
        } else if (file.contextType === 'PROJECT' || file.contextType === 'TASK') {
            if (file.contextId) {
                const canAccess = await ProjectService.canAccessProject(
                    user.companyId,
                    user.userId,
                    file.contextId.toString()
                );
                if (!canAccess) {
                    throw new Error('FORBIDDEN_PROJECT');
                }
            }
        }

        return file;
    }

    /**
     * Soft delete a file.
     */
    static async softDeleteFile(fileId: string, user: { userId: string; companyId?: string; role: string }): Promise<boolean> {
        const file = await this.getAuthorizedFile(fileId, user);

        // Only uploader or admin can delete
        const isUploader = file.uploadedBy.toString() === user.userId;
        const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN' || user.role === 'Admin';
        if (!isUploader && !isAdmin) {
            throw new Error('FORBIDDEN_DELETE');
        }

        file.deletedAt = new Date();
        await file.save();
        return true;
    }

    /**
     * Resolve a fresh, secure delivery URL (signed if token security key is configured).
     */
    static async resolveFileUrl(fileDoc: IFileDocument, expiresInSeconds = 3600): Promise<string> {
        if (!fileDoc.storageKey) {
            return fileDoc.storageUrl;
        }

        try {
            const activeConfig = await StorageConfigurationService.getActiveConfiguration();
            if (activeConfig && activeConfig.enabled) {
                const provider = StorageProviderFactory.createProvider(
                    activeConfig.provider,
                    activeConfig.configuration
                );
                if (typeof (provider as any).getSignedUrl === 'function') {
                    return (provider as any).getSignedUrl(fileDoc.storageKey, expiresInSeconds);
                }
                return provider.getFileUrl(fileDoc.storageKey);
            }
        } catch {
            // Fallback to stored URL
        }

        return fileDoc.storageUrl;
    }
}
export default FileService;
