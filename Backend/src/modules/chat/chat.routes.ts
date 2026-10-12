import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createConversationSchema,
    listMessagesSchema,
} from './chat.validator';
import { requireCompanyFeature } from '../../middleware/feature-toggle.middleware';
import { requireModuleAccess } from '../../middleware/module-access.middleware';

const router = Router();

// All chat routes require authentication, enabled chat feature & member access
router.use(authenticate);
router.use(requireCompanyFeature('enableChat'));
router.use(requireModuleAccess('chat'));

// ── Conversations ─────────────────────────────────────────────────────────────
// POST /api/conversations
router.post(
    '/',
    validateRequest(createConversationSchema),
    ChatController.createConversation
);

// GET /api/conversations
router.get('/', ChatController.getConversations);

// GET /api/conversations/:conversationId/messages
router.get(
    '/:conversationId/messages',
    validateRequest(listMessagesSchema),
    ChatController.getMessages
);

export default router;
