import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { MeetingRequestController } from './meeting-request.controller';

const router = Router();

// Authentication required for all meeting request endpoints
router.use(authenticate);

// POST /api/meetings/requests
router.post('/', MeetingRequestController.createRequest);

// GET /api/meetings/requests/pending
router.get('/pending', MeetingRequestController.getPendingRequests);

export default router;
