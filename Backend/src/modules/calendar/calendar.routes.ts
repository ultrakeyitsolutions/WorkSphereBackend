import { Router } from 'express';
import { CalendarController } from './calendar.controller';

const router = Router();

// ── Calendar Events Endpoints ───────────────────────────────────────────────
router.get('/events', CalendarController.getEvents);
router.post('/events', CalendarController.createEvent);
router.put('/events/:id', CalendarController.updateEvent);
router.patch('/events/:id/reschedule', CalendarController.rescheduleEvent);
router.patch('/events/:id/rsvp', CalendarController.rsvpEvent);
router.delete('/events/:id', CalendarController.deleteEvent);

// ── Quick Meeting Generator ────────────────────────────────────────────────
router.post('/quick-meeting', CalendarController.quickMeeting);

// ── OAuth Integrations ─────────────────────────────────────────────────────
router.get('/oauth/status', CalendarController.getOAuthStatus);
router.post('/oauth/:provider/connect', CalendarController.connectOAuth);
router.delete('/oauth/:provider/disconnect', CalendarController.disconnectOAuth);

export default router;
