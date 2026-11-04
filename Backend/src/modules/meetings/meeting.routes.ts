import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authorizeRoles } from '../../middleware/authorization.middleware';
import meetingRequestRoutes from './meeting-request.routes';
import { MeetingController } from './meeting.controller';
import { requireModuleAccess } from '../../middleware/module-access.middleware';

const router = Router();

// Authentication and module access required for all meeting endpoints
router.use(authenticate);
router.use(requireModuleAccess('meetings'));

// ── Sub-routes ───────────────────────────────────────────────────────────────
router.use('/requests', meetingRequestRoutes);

// ── Instant Video Room Creation ───────────────────────────────────────────────
router.post('/instant', MeetingController.createInstantMeeting);

// ── Summary Metrics ───────────────────────────────────────────────────────────
router.get('/summary-metrics', MeetingController.getSummaryMetrics);

// ── List & Queries ────────────────────────────────────────────────────────────
router.get('/my', MeetingController.getMyMeetings);
router.get('/assigned', MeetingController.getAssignedMeetings);
router.get('/company', authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN', 'MANAGER'), MeetingController.getCompanyMeetings);
router.get('/team', authorizeRoles('COMPANY_ADMIN', 'Admin', 'SUPER_ADMIN', 'MANAGER'), MeetingController.getTeamMeetings);
router.get('/upcoming', MeetingController.getUpcomingMeetings);
router.get('/history', MeetingController.getMeetingHistory);
router.get('/availability', MeetingController.getAvailability);

// ── Consolidated Reports ──────────────────────────────────────────────────────
router.get('/reports', MeetingController.getMeetingReports);

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
