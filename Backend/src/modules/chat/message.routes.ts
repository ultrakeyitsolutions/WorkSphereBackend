import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { messageParamSchema } from './chat.validator';

const router = Router();

// All message routes require authentication
router.use(authenticate);

// DELETE /api/messages/:messageId
router.delete('/:messageId', validateRequest(messageParamSchema), ChatController.deleteMessage);

export default router;
