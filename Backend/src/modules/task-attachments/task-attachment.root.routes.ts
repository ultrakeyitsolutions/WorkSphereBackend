import { Router } from 'express';
import { deleteAttachment } from './task-attachment.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { attachmentParamSchema } from './task-attachment.validator';

const router = Router();

// Mounted at /api/v1/company/task-attachments

router.delete('/:attachmentId', validateRequest(attachmentParamSchema), deleteAttachment);

export default router;
