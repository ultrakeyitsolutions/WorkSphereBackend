import { Router } from 'express';
import { InvitationController } from './invitation.controller';

/**
 * All routes here are mounted under /api/v1/company/invitations
 * and protected by the company-admin middleware chain.
 */
const router = Router();

// POST /api/v1/company/invitations
router.post('/', InvitationController.inviteMembers);

// GET  /api/v1/company/invitations
router.get('/', InvitationController.list);

// POST /api/v1/company/invitations/:invitationId/resend
router.post('/:invitationId/resend', InvitationController.resend);

// POST /api/v1/company/invitations/:invitationId/cancel
router.post('/:invitationId/cancel', InvitationController.cancel);

export default router;
