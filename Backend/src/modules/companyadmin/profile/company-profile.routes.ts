import { Router } from 'express';
import { getCompanyProfile, updateCompanyProfile } from './company-profile.controller';

const router = Router();

// GET  /api/v1/company/profile
router.get('/', getCompanyProfile);

// PATCH /api/v1/company/profile
router.patch('/', updateCompanyProfile);

export default router;
