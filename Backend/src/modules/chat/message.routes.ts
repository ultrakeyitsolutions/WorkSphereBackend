import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { messageParamSchema } from './chat.validator';
import { requireCompanyFeature } from '../../middleware/feature-toggle.middleware';

const router = Router();

// All message routes require authentication & enabled chat feature
router.use(authenticate);
router.use(requireCompanyFeature('enableChat'));

// DELETE /api/messages/:messageId
router.delete('/:messageId', validateRequest(messageParamSchema), ChatController.deleteMessage);

export default router;
