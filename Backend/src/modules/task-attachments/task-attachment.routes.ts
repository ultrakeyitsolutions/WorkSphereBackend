import { Router } from 'express';
import { createAttachment, getAttachments, deleteAttachment } from './task-attachment.controller';
import { validateRequest } from '../../middleware/validateRequest';
import { createAttachmentSchema, attachmentParamSchema } from './task-attachment.validator';
import { requireCompanyFeature } from '../../middleware/feature-toggle.middleware';

const router = Router({ mergeParams: true });

// Mounted at /api/v1/company/tasks/:taskId/attachments
// and /api/v1/member/tasks/:taskId/attachments

router.post('/', requireCompanyFeature('enableTaskAttachments'), validateRequest(createAttachmentSchema), createAttachment);
router.post('/voice-note', requireCompanyFeature('enableTaskAttachments'), validateRequest(createAttachmentSchema), createAttachment);
router.get('/', getAttachments);
router.delete('/:attachmentId', validateRequest(attachmentParamSchema), deleteAttachment);

export default router;
