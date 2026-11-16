import { Router } from 'express';
import multer from 'multer';
import { FileController } from './file.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// Configure multer with memory storage (no unmanaged local disk artifacts)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB safety ceiling at express layer
    },
});

// All file routes require authentication
router.use(authenticate);

// POST /api/files/upload with graceful multer error handling
router.post(
    '/upload',
    (req, res, next) => {
        upload.single('file')(req, res, (err: any) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({
                            success: false,
                            message: 'File size exceeds maximum upload threshold.',
                        });
                    }
                    return res.status(400).json({
                        success: false,
                        message: `Upload error: ${err.message}`,
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: err.message || 'File upload error',
                });
            }
            next();
        });
    },
    FileController.uploadFile
);

// GET /api/files/:fileId
router.get('/:fileId', FileController.getFile);

// GET /api/files/:fileId/stream (HTTP Range & 206 partial content streaming)
router.get('/:fileId/stream', FileController.streamFile);
router.head('/:fileId/stream', FileController.streamFile);

// GET /api/files/:fileId/stream-url (Authorized media reference with refreshed access)
router.get('/:fileId/stream-url', FileController.getStreamUrl);

// GET /api/files/:fileId/download
router.get('/:fileId/download', FileController.downloadFile);

// DELETE /api/files/:fileId
router.delete('/:fileId', FileController.deleteFile);

export default router;
