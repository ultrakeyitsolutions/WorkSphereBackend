import { Router } from 'express';
import * as MemberDeletionController from './member-deletion.controller';

const router = Router();

// DELETE /api/v1/company/members/:memberId
// Delete a company member with specified deletion mode
// Body: { deletionMode: "MEMBER_ONLY" | "ENTIRE_RECORD", confirmation?: boolean }
// For MEMBER_ONLY: optionally { deletionMode: "MEMBER_ONLY" }
// For ENTIRE_RECORD: requires { deletionMode: "ENTIRE_RECORD", confirmation: true }
router.delete('/:memberId', MemberDeletionController.deleteMember);

// GET /api/v1/company/members/:memberId/deletion-plan
// Preview deletion plan before executing
router.get('/:memberId/deletion-plan', MemberDeletionController.getMemberDeletionPlan);

export default router;