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

            const userId = req.user?.userId;
            const companyId = req.user?.companyId;

            if (!userId || !companyId) {
                return sendError(res, 'Authentication and company context required', 401);
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

            return sendSuccess(res, 'File uploaded successfully', uploadedFile, 201);
        } catch (error: any) {
            return sendError(res, error.message || 'File upload failed', 400);
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

            const secureUrl = await FileService.resolveFileUrl(file);
            // Redirect user to authorized expiring signed URL
            res.redirect(secureUrl);
        } catch (error: any) {
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
