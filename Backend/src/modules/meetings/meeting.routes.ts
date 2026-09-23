import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import meetingRequestRoutes from './meeting-request.routes';
import { MeetingController } from './meeting.controller';

const router = Router();

// Authentication required for all meeting endpoints
router.use(authenticate);

// ── Sub-routes ───────────────────────────────────────────────────────────────
router.use('/requests', meetingRequestRoutes);

// ── List & Queries ────────────────────────────────────────────────────────────
router.get('/my', MeetingController.getMyMeetings);
router.get('/assigned', MeetingController.getAssignedMeetings);
router.get('/company', authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN', 'MANAGER'), MeetingController.getCompanyMeetings);
router.get('/upcoming', MeetingController.getUpcomingMeetings);
router.get('/history', MeetingController.getMeetingHistory);
router.get('/availability', MeetingController.getAvailability);

// ── Single Meeting Lifecycle Actions ──────────────────────────────────────────
router.get('/:meetingId', MeetingController.getMeetingById);
router.post('/:meetingId/accept', MeetingController.acceptMeeting);
router.post('/:meetingId/reject', MeetingController.rejectMeeting);
router.post('/:meetingId/reschedule-request', MeetingController.requestReschedule);

router.post('/:meetingId/reschedule/accept', MeetingController.acceptReschedule);
router.post('/:meetingId/reschedule/reject', MeetingController.rejectReschedule);
router.post('/:meetingId/reschedule/propose', MeetingController.proposeReschedule);

router.post('/:meetingId/cancel', MeetingController.cancelMeeting);
router.post('/:meetingId/join', MeetingController.joinMeeting);

export default router;
