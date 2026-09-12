import { Router } from 'express';
import { ChatController } from '../../chat/chat.controller';
import { authenticate } from '../../../middleware/auth.middleware';

const router = Router();

// Authentication required
router.use(authenticate);

// GET /api/projects/:projectId/members
router.get('/:projectId/members', ChatController.getProjectMembers);

export default router;
