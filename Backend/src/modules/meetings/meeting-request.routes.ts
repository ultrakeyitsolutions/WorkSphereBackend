import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { MeetingRequestController } from './meeting-request.controller';
import { requireCompanyFeature } from '../../middleware/feature-toggle.middleware';

const router = Router();

// Authentication required for all meeting request endpoints
router.use(authenticate);

// POST /api/meetings/requests (Quick meeting request creation)
router.post('/', requireCompanyFeature('enableQuickMeetings'), MeetingRequestController.createRequest);

// GET /api/meetings/requests/pending
router.get('/pending', MeetingRequestController.getPendingRequests);

export default router;
