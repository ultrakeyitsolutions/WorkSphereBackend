import crypto from 'crypto';
import { Readable } from 'stream';
import { Response } from 'express';
import { Types } from 'mongoose';
import { FileModel } from './file.model';
import { IFileDocument, FileContextType } from './file.types';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../../infrastructure/storage/storage-provider.factory';
import { CloudinaryStorageProvider } from '../../infrastructure/storage/providers/cloudinary-storage.provider';
import { validateUploadedFile } from './file.validator';
import { ChatService } from '../chat/chat.service';
import { ProjectService } from '../companyadmin/projects/project.service';
import { SubscriptionQuotaService } from '../../services/subscription-quota.service';

export interface UploadOptions {
    file: Express.Multer.File;
    companyId?: string;
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

        // 1. Quota reservation before storage upload and persistence
        let reservation: { commit: () => Promise<void>; release: () => Promise<void> } | null = null;
        if (companyId) {
            reservation = await SubscriptionQuotaService.reserveQuota(companyId, 'storage', file.size);
        }

        try {
            // 2. Get active storage configuration
            const activeConfig = await StorageConfigurationService.getActiveConfiguration();
            if (!activeConfig || !activeConfig.enabled) {
                const err: any = new Error('File storage service is currently disabled or unconfigured.');
                err.statusCode = 503;
                throw err;
            }

            // 3. Validate file against dynamic limits and allowed types
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

            // 4. Generate structured storage key
            const basePath = (activeConfig.configuration?.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
            const targetFolder = folder
                ? folder.replace(/^\/+|\/+$/g, '')
                : `${contextType.toLowerCase()}s`;
            const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            const companyFolder = companyId ? `companies/${companyId}` : 'platform';
            const storageKey = `${basePath}/${companyFolder}/${targetFolder}/${uniquePrefix}-${sanitizedOriginal}`;

            // 5. Resolve active storage provider
            const provider = StorageProviderFactory.createProvider(
                activeConfig.provider,
                activeConfig.configuration
            );

            // 6. Upload to storage provider
            let uploadResult;
            try {
                uploadResult = await provider.uploadFile(file.buffer, storageKey, file.mimetype);
            } catch (uploadError: any) {
                console.error('[FileService] Storage provider upload failed:', uploadError);
                throw new Error(`Failed to upload file to storage: ${uploadError.message}`);
            }

            // 7. Extract extension, resource type, and compute SHA-256 checksum
            const extension = file.originalname.split('.').pop()?.toLowerCase() || '';
            const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
            const resourceType = CloudinaryStorageProvider.resolveResourceType(uploadResult.storageKey || storageKey, file.mimetype);

            // 8. Persist metadata in MongoDB with rollback on failure
            try {
                const fileDoc = await FileModel.create({
                    companyId: companyId && Types.ObjectId.isValid(companyId) ? new Types.ObjectId(companyId) : undefined,
                    uploadedBy: new Types.ObjectId(userId),
                    originalName: file.originalname,
                    storageKey: uploadResult.storageKey,
                    storageUrl: uploadResult.storageUrl,
                    mimeType: file.mimetype,
                    extension,
                    size: file.size,
                    provider: activeConfig.provider,
                    contextType,
                    contextId: (contextId ? (Types.ObjectId.isValid(contextId) ? new Types.ObjectId(contextId) : contextId) : undefined) as any,
                    checksum,
                    resourceType,
                    publicId: (uploadResult.storageKey || storageKey).replace(/\.[a-zA-Z0-9]+$/, ''),
                    processingStatus: 'READY',
                });

                if (reservation) {
                    await reservation.commit();
                }

                return fileDoc;
            } catch (dbError: any) {
                console.error('[FileService] MongoDB file record creation failed. Rolling back storage file:', dbError);
                // Rollback uploaded file from storage provider to prevent orphaned files
                await provider.deleteFile(storageKey).catch((delErr) => {
                    console.error('[FileService] Failed to clean up orphaned storage file:', delErr);
                });
                throw new Error('Database record creation failed. File upload rolled back.');
            }
        } catch (error: any) {
            if (reservation) {
                await reservation.release().catch((rErr) => {
                    console.error('[FileService] Failed to release storage quota reservation:', rErr);
                });
            }
            throw error;
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
        if (!user.companyId || !file.companyId || file.companyId.toString() !== user.companyId.toString()) {
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

        const effectiveKey =
            fileDoc.storageKey && fileDoc.extension && !fileDoc.storageKey.endsWith(`.${fileDoc.extension}`)
                ? `${fileDoc.storageKey}.${fileDoc.extension}`
                : fileDoc.storageKey;

        try {
            const activeConfig = await StorageConfigurationService.getActiveConfiguration();
            if (activeConfig && activeConfig.enabled) {
                const provider = StorageProviderFactory.createProvider(
                    activeConfig.provider,
                    activeConfig.configuration
                );
                if (typeof (provider as any).getSignedUrl === 'function') {
                    return (provider as any).getSignedUrl(effectiveKey, expiresInSeconds);
                }
                return provider.getFileUrl(effectiveKey);
            }
        } catch {
            // Fallback to stored URL
        }

        let fallbackUrl = fileDoc.storageUrl;
        if (fallbackUrl && fallbackUrl.startsWith('cloudinary://')) {
            fallbackUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(fallbackUrl);
        }
        return fallbackUrl;
    }

    /**
     * Resolve the authorized streaming URL for this file (points to /api/files/:fileId/stream with token).
     */
    static resolveFileStreamUrl(fileId: string, token?: string): string {
        const query = token ? `?token=${encodeURIComponent(token)}` : '';
        return `/api/files/${fileId}/stream${query}`;
    }

    /**
     * Stream a protected file with byte-range (HTTP 206) support, correct MIME type and inline disposition.
     */
    static async streamFile(
        fileId: string,
        user: { userId: string; companyId?: string; role: string },
        rangeHeader: string | undefined,
        res: Response,
        isHead = false,
        disposition: 'inline' | 'attachment' = 'inline'
    ): Promise<void> {
        const file = await this.getAuthorizedFile(fileId, user);

        const mimeType = file.mimeType || 'video/mp4';
        const fileName = file.originalName || 'video.mp4';
        const totalSize = file.size;

        // Base response headers for all media streaming responses
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        if (isHead) {
            res.setHeader('Content-Length', totalSize.toString());
            res.status(200).end();
            return;
        }

        let streamed = false;

        // Attempt 1: Fetch via storage provider getFileStream if storageKey exists
        if (file.storageKey) {
            try {
                const activeConfig = await StorageConfigurationService.getActiveConfiguration();
                if (activeConfig && activeConfig.enabled) {
                    const provider = StorageProviderFactory.createProvider(
                        activeConfig.provider,
                        activeConfig.configuration
                    );

                    if (typeof (provider as any).getFileStream === 'function') {
                        const effectiveKey =
                            file.storageKey && file.extension && !file.storageKey.endsWith(`.${file.extension}`)
                                ? `${file.storageKey}.${file.extension}`
                                : file.storageKey;
                        const streamResult = await (provider as any).getFileStream(effectiveKey, rangeHeader);
                        res.status(streamResult.statusCode || (rangeHeader ? 206 : 200));

                        if (streamResult.headers['content-range']) {
                            res.setHeader('Content-Range', streamResult.headers['content-range'] as string);
                        }
                        if (streamResult.headers['content-length']) {
                            res.setHeader('Content-Length', streamResult.headers['content-length'] as string);
                        }

                        streamResult.stream.pipe(res);
                        res.on('close', () => {
                            if (typeof (streamResult.stream as any).destroy === 'function') {
                                (streamResult.stream as any).destroy();
                            }
                        });
                        streamed = true;
                        return;
                    }
                }
            } catch (err: any) {
                console.warn('[FileService] Provider stream error, falling back to direct media fetch:', err.message);
            }
        }

        // Attempt 2: Fallback to direct fetch from resolved storageUrl with Range forwarding
        if (!streamed) {
            const mediaUrl = await this.resolveFileUrl(file);
            const fetchHeaders: Record<string, string> = {};
            if (rangeHeader) {
                fetchHeaders['Range'] = rangeHeader;
            }

            const response = await fetch(mediaUrl, {
                method: 'GET',
                headers: fetchHeaders,
            });

            if (!response.ok && response.status !== 206) {
                throw new Error(`Media fetch failed with status ${response.status}: ${response.statusText}`);
            }

            res.status(response.status);
            const contentRange = response.headers.get('content-range');
            const contentLength = response.headers.get('content-length');
            const resolvedType = response.headers.get('content-type') || mimeType;

            res.setHeader('Content-Type', resolvedType);
            if (contentRange) res.setHeader('Content-Range', contentRange);
            if (contentLength) res.setHeader('Content-Length', contentLength);

            const stream = response.body
                ? (Readable.fromWeb(response.body as any) as NodeJS.ReadableStream)
                : Readable.from(Buffer.alloc(0));

            stream.pipe(res);
            res.on('close', () => {
                if (typeof (stream as any).destroy === 'function') {
                    (stream as any).destroy();
                }
            });
        }
    }
}
export default FileService;
