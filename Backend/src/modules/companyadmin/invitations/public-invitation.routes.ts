import { Router } from 'express';
import { InvitationController } from './invitation.controller';

/**
 * Public invitation routes — NO authentication middleware.
 * Mounted at /api/v1/invitations
 */
const router = Router();

// GET  /api/v1/invitations/validate?token=xxx
router.get('/validate', InvitationController.validateToken);

// POST /api/v1/invitations/accept
router.post('/accept', InvitationController.accept);

// POST /api/v1/invitations/register
router.post('/register', InvitationController.register);

export default router;
