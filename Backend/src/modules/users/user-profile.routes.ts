import { Router } from 'express';
import { UserProfileController } from './user-profile.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// All user profile routes require authentication
router.use(authenticate);

// GET /api/v1/user/profile or /api/v1/member/profile
router.get('/', UserProfileController.getProfile);

// PATCH /api/v1/user/profile or /api/v1/member/profile
router.patch('/', UserProfileController.updateProfile);

// PUT /api/v1/user/profile or /api/v1/member/profile
router.put('/', UserProfileController.updateProfile);

export default router;
