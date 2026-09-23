import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { StickyNoteService } from './sticky-note.service';
import { StickyNoteReminderService } from './sticky-note-reminder.service';
import {
    createStickyNoteSchema,
    updateStickyNoteSchema,
    pinStickyNoteSchema,
    completeStickyNoteSchema,
    convertToTaskSchema,
    queryStickyNotesSchema,
    upcomingRemindersQuerySchema,
} from './sticky-note-validation.service';
import { sendSuccess, sendError } from '../../utils/response';
import { AppError } from '../../utils/AppError';

export class StickyNoteController {
    // ─── POST /api/sticky-notes ───────────────────────────────────────────────
    static async createNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const parsed = createStickyNoteSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation failed', 422, parsed.error.format());
            }

            const note = await StickyNoteService.createNote(
                parsed.data,
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note created successfully', note, 201);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to create sticky note', 500);
        }
    }

    // ─── GET /api/sticky-notes ────────────────────────────────────────────────
    static async getNotes(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const parsed = queryStickyNotesSchema.safeParse(req.query);
            if (!parsed.success) {
                return sendError(res, 'Invalid query parameters', 422, parsed.error.format());
            }

            const result = await StickyNoteService.getNotes(userId, parsed.data);
            return sendSuccess(res, 'Sticky notes retrieved successfully', result);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve sticky notes', 500);
        }
    }

    // ─── GET /api/sticky-notes/trash ──────────────────────────────────────────
    static async getTrashNotes(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

            const result = await StickyNoteService.getTrashNotes(userId, page, limit);
            return sendSuccess(res, 'Trash notes retrieved successfully', result);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve trash notes', 500);
        }
    }

    // ─── GET /api/sticky-notes/statistics ─────────────────────────────────────
    static async getStatistics(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const stats = await StickyNoteService.getStatistics(userId);
            return sendSuccess(res, 'Sticky note statistics retrieved successfully', stats);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve statistics', 500);
        }
    }

    // ─── GET /api/sticky-notes/reminders/upcoming ─────────────────────────────
    static async getUpcomingReminders(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const parsed = upcomingRemindersQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                return sendError(res, 'Invalid reminder query parameters', 422, parsed.error.format());
            }

            const result = await StickyNoteReminderService.getUpcomingReminders(userId, parsed.data);
            return sendSuccess(res, 'Upcoming reminders retrieved successfully', result);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve upcoming reminders', 500);
        }
    }

    // ─── GET /api/sticky-notes/:noteId ────────────────────────────────────────
    static async getNoteById(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const note = await StickyNoteService.getNoteById(String(noteId), userId);
            return sendSuccess(res, 'Sticky note retrieved successfully', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to retrieve sticky note', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId ──────────────────────────────────────
    static async updateNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const parsed = updateStickyNoteSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation failed', 422, parsed.error.format());
            }

            const note = await StickyNoteService.updateNote(
                String(noteId),
                parsed.data,
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note updated successfully', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to update sticky note', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId/pin ──────────────────────────────────
    static async pinNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const parsed = pinStickyNoteSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation failed', 422, parsed.error.format());
            }

            const note = await StickyNoteService.pinNote(String(noteId), parsed.data.isPinned, userId);
            return sendSuccess(res, 'Sticky note pinned state updated', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to update pin state', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId/complete ─────────────────────────────
    static async completeNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const parsed = completeStickyNoteSchema.safeParse(req.body || {});
            const completed = parsed.success ? parsed.data.completed : true;

            const note = await StickyNoteService.completeNote(
                String(noteId),
                completed,
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note completion state updated', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to update completion state', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId/archive ──────────────────────────────
    static async archiveNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const note = await StickyNoteService.archiveNote(
                String(noteId),
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note archived successfully', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to archive sticky note', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId/restore ──────────────────────────────
    static async restoreArchivedNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const note = await StickyNoteService.restoreArchivedNote(
                String(noteId),
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note restored from archive successfully', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to restore archived sticky note', 500);
        }
    }

    // ─── DELETE /api/sticky-notes/:noteId ─────────────────────────────────────
    static async deleteNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const result = await StickyNoteService.deleteNote(
                String(noteId),
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note moved to trash successfully', result);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to delete sticky note', 500);
        }
    }

    // ─── PATCH /api/sticky-notes/:noteId/restore-from-trash ───────────────────
    static async restoreFromTrash(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const note = await StickyNoteService.restoreFromTrash(
                String(noteId),
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note restored from trash successfully', note);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to restore sticky note from trash', 500);
        }
    }

    // ─── DELETE /api/sticky-notes/:noteId/permanent ───────────────────────────
    static async permanentDeleteNote(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const result = await StickyNoteService.permanentDeleteNote(
                String(noteId),
                userId,
                req.user?.companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note permanently deleted', result);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to permanently delete sticky note', 500);
        }
    }

    // ─── POST /api/sticky-notes/:noteId/convert-to-task ───────────────────────
    static async convertToTask(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            const companyId = req.user?.companyId;
            if (!userId || !companyId) {
                return sendError(res, 'Unauthorized or missing company context', 401);
            }

            const noteId = Array.isArray(req.params.noteId) ? req.params.noteId[0] : req.params.noteId;
            const parsed = convertToTaskSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendError(res, 'Validation failed', 422, parsed.error.format());
            }

            const result = await StickyNoteService.convertToTask(
                String(noteId),
                parsed.data,
                userId,
                companyId,
                req.user?.email,
                req.user?.role
            );

            return sendSuccess(res, 'Sticky note converted to task successfully', result, 201);
        } catch (error: any) {
            if (error instanceof AppError) {
                return sendError(res, error.message, error.statusCode);
            }
            return sendError(res, error.message || 'Failed to convert sticky note to task', 500);
        }
    }
}
