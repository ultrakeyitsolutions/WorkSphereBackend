import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { FileService } from './file.service';
import { sendSuccess, sendError } from '../../utils/response';
import { FileContextType } from './file.types';

export class FileController {
    /**
     * POST /api/files/upload
     */
    static async uploadFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            const file = req.file;
            if (!file) {
                return sendError(res, 'No file provided for upload', 400);
            }

            const userId = req.user?.userId || req.currentUser?.userId;
            const isSuperAdmin = (req.user?.role || req.currentUser?.role) === 'SUPER_ADMIN';
            const companyId = req.user?.companyId || req.currentUser?.companyId || req.body?.companyId;

            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const contextType = (req.body.contextType || 'OTHER').toUpperCase() as FileContextType;
            const contextId = req.body.contextId;
            const folder = req.body.folder;

            const uploadedFile = await FileService.upload({
                file,
                companyId,
                userId,
                contextType,
                contextId,
                folder,
            });

            const secureUrl = await FileService.resolveFileUrl(uploadedFile);
            const responseData = {
                ...(uploadedFile.toObject ? uploadedFile.toObject() : uploadedFile),
                storageUrl: secureUrl,
            };

            return sendSuccess(res, 'File uploaded successfully', responseData, 201);
        } catch (error: any) {
            return sendError(
                res,
                error.message || 'File upload failed',
                error.statusCode || 400,
                error.errors || error.details || undefined
            );
        }
    }

    /**
     * GET /api/files/:fileId
     */
    static async getFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            if (!req.user) {
                return sendError(res, 'Unauthorized', 401);
            }

            const file = await FileService.getAuthorizedFile(req.params.fileId as string, {
                userId: req.user.userId,
                companyId: req.user.companyId,
                role: req.user.role,
            });

            const secureUrl = await FileService.resolveFileUrl(file);
            const responseData = {
                ...(file.toObject ? file.toObject() : file),
                storageUrl: secureUrl,
            };

            return sendSuccess(res, 'File retrieved successfully', responseData);
        } catch (error: any) {
            if (error.message === 'FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                return sendError(res, 'File not found', 404);
            }
            if (error.message.startsWith('FORBIDDEN')) {
                return sendError(res, 'You are not authorized to access this file', 403);
            }
            return sendError(res, error.message || 'Failed to retrieve file', 500);
        }
    }

    /**
     * GET /api/files/:fileId/download
     */
    static async downloadFile(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }

            const file = await FileService.getAuthorizedFile(req.params.fileId as string, {
                userId: req.user.userId,
                companyId: req.user.companyId,
                role: req.user.role,
            });

            // If caller requests json or specifies redirect=false, return JSON with signed URL and metadata for programmatic progress download
            const acceptsJson = req.headers.accept?.includes('application/json');
            const redirectFalse = req.query.redirect === 'false';
            const redirectTrue = req.query.redirect === 'true';

            const secureUrl = await FileService.resolveFileUrl(file);

            if (acceptsJson || redirectFalse) {
                res.status(200).json({
                    success: true,
                    message: 'Download URL generated',
                    data: {
                        downloadUrl: secureUrl,
                        fileName: file.originalName,
                        mimeType: file.mimeType,
                        size: file.size,
                    },
                });
                return;
            }

            // If client explicitly requested direct CDN redirect (redirect=true), redirect to verified signed URL
            if (redirectTrue) {
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
                res.redirect(secureUrl);
                return;
            }

            // By default, stream file bytes directly through backend proxy with attachment disposition and authoritative MIME type.
            // This prevents saving Cloudinary HTML/JSON error bodies as documents (fixing Bug A 0xC00D36C4 and Bug C corrupted files).
            await FileService.streamFile(
                req.params.fileId as string,
                {
                    userId: req.user.userId,
                    companyId: req.user.companyId,
                    role: req.user.role,
                },
                req.headers.range,
                res,
                req.method === 'HEAD',
                'attachment'
            );
        } catch (error: any) {
            if (res.headersSent) {
                return;
            }
            if (error.message === 'FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                sendError(res, 'File not found', 404);
                return;
            }
            if (error.message.startsWith('FORBIDDEN')) {
                sendError(res, 'You are not authorized to download this file', 403);
                return;
            }
            sendError(res, error.message || 'Failed to download file', 500);
        }
    }

    /**
     * GET /api/files/:fileId/stream
     * HEAD /api/files/:fileId/stream
     * Stream authorized video/media with full HTTP Range (206) and inline playback support.
     */
    static async streamFile(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }

            await FileService.streamFile(
                req.params.fileId as string,
                {
                    userId: req.user.userId,
                    companyId: req.user.companyId,
                    role: req.user.role,
                },
                req.headers.range,
                res,
                req.method === 'HEAD'
            );
        } catch (error: any) {
            if (res.headersSent) {
                return;
            }
            if (error.message === 'FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                sendError(res, 'File not found', 404);
                return;
            }
            if (error.message.startsWith('FORBIDDEN')) {
                sendError(res, 'You are not authorized to stream this file', 403);
                return;
            }
            sendError(res, error.message || 'Failed to stream media', 500);
        }
    }

    /**
     * GET /api/files/:fileId/stream-url
     * Get authorized streaming URL and refreshed token/access info.
     */
    static async getStreamUrl(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            if (!req.user) {
                return sendError(res, 'Unauthorized', 401);
            }

            const file = await FileService.getAuthorizedFile(req.params.fileId as string, {
                userId: req.user.userId,
                companyId: req.user.companyId,
                role: req.user.role,
            });

            // Extract auth token from request header or query
            const authHeader = req.headers.authorization;
            const token = authHeader && authHeader.startsWith('Bearer ')
                ? authHeader.split(' ')[1]
                : (req.query.token as string) || '';

            const streamUrl = FileService.resolveFileStreamUrl(file._id.toString(), token);
            const directUrl = await FileService.resolveFileUrl(file);

            return sendSuccess(res, 'Stream URL resolved successfully', {
                fileId: file._id,
                streamUrl,
                directUrl,
                fileName: file.originalName,
                mimeType: file.mimeType,
                size: file.size,
            });
        } catch (error: any) {
            if (error.message === 'FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                return sendError(res, 'File not found', 404);
            }
            if (error.message.startsWith('FORBIDDEN')) {
                return sendError(res, 'You are not authorized to access this file', 403);
            }
            return sendError(res, error.message || 'Failed to resolve stream URL', 500);
        }
    }

    /**
     * DELETE /api/files/:fileId
     */
    static async deleteFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
        try {
            if (!req.user) {
                return sendError(res, 'Unauthorized', 401);
            }

            await FileService.softDeleteFile(req.params.fileId as string, {
                userId: req.user.userId,
                companyId: req.user.companyId,
                role: req.user.role,
            });

            return sendSuccess(res, 'File deleted successfully');
        } catch (error: any) {
            if (error.message === 'FILE_NOT_FOUND' || error.message === 'INVALID_FILE_ID') {
                return sendError(res, 'File not found', 404);
            }
            if (error.message.startsWith('FORBIDDEN')) {
                return sendError(res, 'You are not authorized to delete this file', 403);
            }
            return sendError(res, error.message || 'Failed to delete file', 500);
        }
    }
}
export default FileController;
