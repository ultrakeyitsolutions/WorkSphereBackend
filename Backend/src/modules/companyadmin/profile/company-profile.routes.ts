import { Router } from 'express';
import {
    getCompanyProfile,
    updateCompanyProfile,
    getAvailablePlans,
    createUpgradeRequest,
    getUpgradeRequests,
} from './company-profile.controller';

const router = Router();

// GET  /api/v1/company/profile
router.get('/', getCompanyProfile);

// PATCH /api/v1/company/profile
router.patch('/', updateCompanyProfile);

// GET  /api/v1/company/profile/plans
router.get('/plans', getAvailablePlans);

// POST /api/v1/company/profile/upgrade-request
router.post('/upgrade-request', createUpgradeRequest);

// GET  /api/v1/company/profile/upgrade-requests
router.get('/upgrade-requests', getUpgradeRequests);

export default router;
