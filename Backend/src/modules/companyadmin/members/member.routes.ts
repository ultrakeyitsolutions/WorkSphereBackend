import { Router } from 'express';
import * as MemberController from './member.controller';

const router = Router();

router.patch('/:memberId/status', MemberController.updateMemberStatus);
router.patch('/:memberId/biometric', MemberController.updateMemberBiometric);

export default router;
