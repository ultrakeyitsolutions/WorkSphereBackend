import { Router } from 'express';
import { getMemberDashboardStats } from './member-dashboard.controller';

const router = Router();

// GET /api/v1/member/dashboard/stats  — or  /api/v1/company/dashboard/stats
router.get('/stats', getMemberDashboardStats);

export default router;
