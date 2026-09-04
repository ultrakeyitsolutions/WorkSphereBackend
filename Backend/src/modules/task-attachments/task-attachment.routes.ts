import { Router } from 'express';
import { createAttachment, getAttachments } from './task-attachment.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { createAttachmentSchema } from './task-attachment.validator';

const router = Router({ mergeParams: true });

// Mounted at /api/v1/company/tasks/:taskId/attachments

router.post('/', validateRequest(createAttachmentSchema), createAttachment);
router.get('/', getAttachments);

export default router;
