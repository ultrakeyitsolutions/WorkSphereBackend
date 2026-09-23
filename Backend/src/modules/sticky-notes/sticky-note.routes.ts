import { Router } from 'express';
import { StickyNoteController } from './sticky-note.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate as any);

// ── Fixed / Named Routes First (precedence before :noteId) ───────────────────
router.get('/trash', StickyNoteController.getTrashNotes);
router.get('/statistics', StickyNoteController.getStatistics);
router.get('/reminders/upcoming', StickyNoteController.getUpcomingReminders);

// ── CRUD and Individual Note Actions ──────────────────────────────────────────
router.post('/', StickyNoteController.createNote);
router.get('/', StickyNoteController.getNotes);
router.get('/:noteId', StickyNoteController.getNoteById);
router.patch('/:noteId', StickyNoteController.updateNote);
router.patch('/:noteId/pin', StickyNoteController.pinNote);
router.patch('/:noteId/complete', StickyNoteController.completeNote);
router.patch('/:noteId/archive', StickyNoteController.archiveNote);
router.patch('/:noteId/restore', StickyNoteController.restoreArchivedNote);
router.delete('/:noteId', StickyNoteController.deleteNote);
router.patch('/:noteId/restore-from-trash', StickyNoteController.restoreFromTrash);
router.delete('/:noteId/permanent', StickyNoteController.permanentDeleteNote);
router.post('/:noteId/convert-to-task', StickyNoteController.convertToTask);

export default router;
