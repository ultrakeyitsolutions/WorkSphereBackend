import { Router } from 'express';
import * as MemberController from './member.controller';
import * as MemberDeletionController from './member-deletion.controller';

const router = Router();

// Member management routes
router.patch('/:memberId/status', MemberController.updateMemberStatus);
router.patch('/:memberId/biometric', MemberController.updateMemberBiometric);

// DELETE /api/v1/company/members/:memberId - Delete member with two modes
router.delete('/:memberId', MemberDeletionController.deleteMember);
router.get('/:memberId/deletion-plan', MemberDeletionController.getMemberDeletionPlan);

export default router;
