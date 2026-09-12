import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createConversationSchema,
    listMessagesSchema,
} from './chat.validator';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

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
