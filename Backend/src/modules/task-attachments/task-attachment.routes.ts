import { Router } from 'express';
import { createAttachment, getAttachments, deleteAttachment } from './task-attachment.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { createAttachmentSchema, attachmentParamSchema } from './task-attachment.validator';

const router = Router({ mergeParams: true });

// Mounted at /api/v1/company/tasks/:taskId/attachments
// and /api/v1/member/tasks/:taskId/attachments

router.post('/', validateRequest(createAttachmentSchema), createAttachment);
router.post('/voice-note', validateRequest(createAttachmentSchema), createAttachment);
router.get('/', getAttachments);
router.delete('/:attachmentId', validateRequest(attachmentParamSchema), deleteAttachment);

export default router;
