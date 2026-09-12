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

// POST /api/files/upload
router.post('/upload', upload.single('file'), FileController.uploadFile);

// GET /api/files/:fileId
router.get('/:fileId', FileController.getFile);

// GET /api/files/:fileId/download
router.get('/:fileId/download', FileController.downloadFile);

// DELETE /api/files/:fileId
router.delete('/:fileId', FileController.deleteFile);

export default router;
