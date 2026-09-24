import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { StickyNote } from './sticky-note.model';
import {
    CreateStickyNoteInput,
    UpdateStickyNoteInput,
    StickyNoteQueryFilters,
    ConvertToTaskInput,
    StickyNoteStats,
} from './sticky-note.types';
import { StickyNoteStatus, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './sticky-note.constants';
import { StickyNoteValidationService } from './sticky-note-validation.service';
import { TaskService } from '../tasks/task.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { AppError } from '../../utils/AppError';

export class StickyNoteService {
    // ─── Shared Response Mapper ───────────────────────────────────────────────
    private static mapNoteResponse(note: any) {
        return {
            id: note._id ? note._id.toString() : note.id,
            userId: note.userId ? note.userId.toString() : undefined,
            title: note.title || '',
            content: note.content,
            color: note.color,
            priority: note.priority,
            tags: note.tags || [],
            isPinned: Boolean(note.isPinned),
            status: note.status,
            checklist: (note.checklist || []).map((item: any) => ({
                id: item.id || (item._id ? item._id.toString() : randomUUID()),
                text: item.text,
                completed: Boolean(item.completed),
                createdAt: item.createdAt,
                completedAt: item.completedAt || null,
            })),
            projectId: note.projectId ? (note.projectId._id ? note.projectId._id.toString() : note.projectId.toString()) : null,
            project: note.projectId && typeof note.projectId === 'object' && 'name' in note.projectId
                ? { id: note.projectId._id ? note.projectId._id.toString() : String(note.projectId), name: note.projectId.name }
                : null,
            taskId: note.taskId ? (note.taskId._id ? note.taskId._id.toString() : note.taskId.toString()) : null,
            task: note.taskId && typeof note.taskId === 'object' && 'title' in note.taskId
                ? {
                      id: note.taskId._id ? note.taskId._id.toString() : String(note.taskId),
                      title: note.taskId.title,
                      taskNumber: note.taskId.taskNumber,
                  }
                : null,
            convertedTaskId: note.convertedTaskId ? note.convertedTaskId.toString() : null,
            reminderAt: note.reminderAt || null,
            reminderSentAt: note.reminderSentAt || null,
            archivedAt: note.archivedAt || null,
            completedAt: note.completedAt || null,
            deletedAt: note.deletedAt || null,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
        };
    }

    // ─── Create Note ──────────────────────────────────────────────────────────
    static async createNote(
        input: CreateStickyNoteInput,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        // 1. Validate project access if specified
        if (input.projectId) {
            await StickyNoteValidationService.validateProjectAccess(companyId || '', userId, input.projectId);
        }

        // 2. Validate task access if specified
        if (input.taskId) {
            await StickyNoteValidationService.validateTaskAccess(companyId || '', userId, input.taskId, input.projectId);
        }

        // 3. Format checklist items
        const formattedChecklist = (input.checklist || []).map((item) => ({
            id: item.id || randomUUID(),
            text: item.text,
            completed: Boolean(item.completed),
            createdAt: new Date(),
            completedAt: item.completed ? new Date() : null,
        }));

        // 4. Create document
        const noteDoc = new StickyNote({
            userId: new Types.ObjectId(userId),
            title: input.title || '',
            content: input.content,
            color: input.color,
            priority: input.priority,
            tags: input.tags || [],
            isPinned: Boolean(input.isPinned),
            status: StickyNoteStatus.ACTIVE,
            checklist: formattedChecklist,
            projectId: input.projectId ? new Types.ObjectId(input.projectId) : null,
            taskId: input.taskId ? new Types.ObjectId(input.taskId) : null,
            reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
            reminderSentAt: null,
        });

        await noteDoc.save();

        // 5. Populate and return
        const populated = await StickyNote.findById(noteDoc._id)
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        // 6. Audit Log (non-sensitive metadata)
        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_CREATED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: {
                noteId: noteDoc._id.toString(),
                color: noteDoc.color,
                priority: noteDoc.priority,
                hasReminder: Boolean(noteDoc.reminderAt),
                isPinned: noteDoc.isPinned,
            },
            description: `Sticky note created (ID: ${noteDoc._id.toString()})`,
            success: true,
        });

        return this.mapNoteResponse(populated || noteDoc);
    }

    // ─── Get Notes (My Notes) ─────────────────────────────────────────────────
    static async getNotes(userId: string, filters: StickyNoteQueryFilters = {}) {
        const query: Record<string, any> = {
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        };

        if (filters.status) {
            query.status = filters.status;
        }

        if (filters.priority) {
            query.priority = filters.priority;
        }

        if (filters.color) {
            query.color = filters.color;
        }

        if (filters.isPinned !== undefined) {
            query.isPinned = filters.isPinned;
        }

        if (filters.tag) {
            query.tags = filters.tag;
        }

        if (filters.projectId) {
            query.projectId = new Types.ObjectId(filters.projectId);
        }

        if (filters.taskId) {
            query.taskId = new Types.ObjectId(filters.taskId);
        }

        if (filters.search && filters.search.trim().length > 0) {
            const searchRegex = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [
                { title: searchRegex },
                { content: searchRegex },
                { tags: searchRegex },
            ];
        }

        const page = Math.max(1, Number(filters.page) || 1);
        const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(filters.limit) || DEFAULT_PAGE_LIMIT));
        const skip = (page - 1) * limit;

        const sortField = filters.sortBy || 'updatedAt';
        const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;

        // Default compound sorting: pinned notes first, then primary sort field
        const sortOptions: Record<string, 1 | -1> = {
            isPinned: -1,
            [sortField]: sortOrder,
        };

        const [notes, total] = await Promise.all([
            StickyNote.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .populate('projectId', 'name')
                .populate('taskId', 'title taskNumber')
                .lean(),
            StickyNote.countDocuments(query),
        ]);

        return {
            data: notes.map((n) => this.mapNoteResponse(n)),
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ─── Get Trash Notes ──────────────────────────────────────────────────────
    static async getTrashNotes(userId: string, page = 1, limit = DEFAULT_PAGE_LIMIT) {
        const query = {
            userId: new Types.ObjectId(userId),
            deletedAt: { $ne: null },
        };

        const safePage = Math.max(1, page);
        const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, limit));
        const skip = (safePage - 1) * safeLimit;

        const [notes, total] = await Promise.all([
            StickyNote.find(query)
                .sort({ deletedAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .populate('projectId', 'name')
                .populate('taskId', 'title taskNumber')
                .lean(),
            StickyNote.countDocuments(query),
        ]);

        return {
            data: notes.map((n) => this.mapNoteResponse(n)),
            pagination: {
                total,
                page: safePage,
                limit: safeLimit,
                totalPages: Math.ceil(total / safeLimit),
            },
        };
    }

    // ─── Get Single Note ──────────────────────────────────────────────────────
    static async getNoteById(noteId: string, userId: string) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOne({
            _id: new Types.ObjectId(noteId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        })
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        return this.mapNoteResponse(note);
    }

    // ─── Update Note ──────────────────────────────────────────────────────────
    static async updateNote(
        noteId: string,
        input: UpdateStickyNoteInput,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOne({
            _id: new Types.ObjectId(noteId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        // Validate project access if changing project
        if (input.projectId !== undefined) {
            if (input.projectId) {
                await StickyNoteValidationService.validateProjectAccess(companyId || '', userId, input.projectId);
                note.projectId = new Types.ObjectId(input.projectId);
            } else {
                note.projectId = null;
            }
        }

        // Validate task access if changing task
        if (input.taskId !== undefined) {
            if (input.taskId) {
                const effectiveProjectId = input.projectId !== undefined ? input.projectId : note.projectId;
                await StickyNoteValidationService.validateTaskAccess(companyId || '', userId, input.taskId, effectiveProjectId);
                note.taskId = new Types.ObjectId(input.taskId);
            } else {
                note.taskId = null;
            }
        }

        if (input.title !== undefined) note.title = input.title;
        if (input.content !== undefined) note.content = input.content;
        if (input.color !== undefined) note.color = input.color;
        if (input.priority !== undefined) note.priority = input.priority;
        if (input.tags !== undefined) note.tags = input.tags;
        if (input.isPinned !== undefined) note.isPinned = input.isPinned;

        // Reset reminderSentAt if reminderAt is updated
        if (input.reminderAt !== undefined) {
            const newReminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
            const isChanged = (note.reminderAt?.getTime() || null) !== (newReminderAt?.getTime() || null);
            if (isChanged) {
                note.reminderAt = newReminderAt;
                note.reminderSentAt = null;
            }
        }

        // Checklist update
        if (input.checklist !== undefined) {
            note.checklist = (input.checklist || []).map((item) => ({
                id: item.id || randomUUID(),
                text: item.text,
                completed: Boolean(item.completed),
                createdAt: new Date(),
                completedAt: item.completed
                    ? item.completedAt
                        ? new Date(item.completedAt)
                        : new Date()
                    : null,
            })) as any;
        }

        await note.save();

        const populated = await StickyNote.findById(note._id)
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_UPDATED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: {
                noteId: note._id.toString(),
            },
            description: `Sticky note updated (ID: ${note._id.toString()})`,
            success: true,
        });

        return this.mapNoteResponse(populated || note);
    }

    // ─── Pin / Unpin Note ─────────────────────────────────────────────────────
    static async pinNote(noteId: string, isPinned: boolean, userId: string) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: null,
            },
            {
                $set: { isPinned },
            },
            { new: true }
        )
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        return this.mapNoteResponse(note);
    }

    // ─── Complete / Reopen Note ───────────────────────────────────────────────
    static async completeNote(
        noteId: string,
        completed: boolean,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const updates: any = completed
            ? {
                  status: StickyNoteStatus.COMPLETED,
                  completedAt: new Date(),
              }
            : {
                  status: StickyNoteStatus.ACTIVE,
                  completedAt: null,
              };

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: null,
            },
            {
                $set: updates,
            },
            { new: true }
        )
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_COMPLETED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: {
                noteId,
                completed,
            },
            description: `Sticky note ${completed ? 'completed' : 'reopened'} (ID: ${noteId})`,
            success: true,
        });

        return this.mapNoteResponse(note);
    }

    // ─── Archive Note ─────────────────────────────────────────────────────────
    static async archiveNote(
        noteId: string,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: null,
            },
            {
                $set: {
                    status: StickyNoteStatus.ARCHIVED,
                    archivedAt: new Date(),
                },
            },
            { new: true }
        )
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_ARCHIVED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: { noteId },
            description: `Sticky note archived (ID: ${noteId})`,
            success: true,
        });

        return this.mapNoteResponse(note);
    }

    // ─── Restore Archived Note ────────────────────────────────────────────────
    static async restoreArchivedNote(
        noteId: string,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: null,
            },
            {
                $set: {
                    status: StickyNoteStatus.ACTIVE,
                    archivedAt: null,
                },
            },
            { new: true }
        )
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_RESTORED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: { noteId, source: 'archive' },
            description: `Sticky note restored from archive (ID: ${noteId})`,
            success: true,
        });

        return this.mapNoteResponse(note);
    }

    // ─── Soft Delete Note ─────────────────────────────────────────────────────
    static async deleteNote(
        noteId: string,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: null,
            },
            {
                $set: { deletedAt: new Date() },
            },
            { new: true }
        );

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_DELETED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: { noteId, isSoftDelete: true },
            description: `Sticky note moved to trash (ID: ${noteId})`,
            success: true,
        });

        return { success: true, message: 'Sticky note moved to trash successfully' };
    }

    // ─── Restore from Trash ───────────────────────────────────────────────────
    static async restoreFromTrash(
        noteId: string,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndUpdate(
            {
                _id: new Types.ObjectId(noteId),
                userId: new Types.ObjectId(userId),
                deletedAt: { $ne: null },
            },
            {
                $set: { deletedAt: null },
            },
            { new: true }
        )
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        if (!note) {
            throw AppError.notFound('Sticky note not found in trash');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_RESTORED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: { noteId, source: 'trash' },
            description: `Sticky note restored from trash (ID: ${noteId})`,
            success: true,
        });

        return this.mapNoteResponse(note);
    }

    // ─── Permanent Delete Note ────────────────────────────────────────────────
    static async permanentDeleteNote(
        noteId: string,
        userId: string,
        companyId?: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOneAndDelete({
            _id: new Types.ObjectId(noteId),
            userId: new Types.ObjectId(userId),
        });

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_DELETED,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId: companyId || null,
            metadata: { noteId, isPermanent: true },
            description: `Sticky note permanently deleted (ID: ${noteId})`,
            success: true,
        });

        return { success: true, message: 'Sticky note permanently deleted' };
    }

    // ─── Convert Note to Task ─────────────────────────────────────────────────
    static async convertToTask(
        noteId: string,
        input: ConvertToTaskInput,
        userId: string,
        companyId: string,
        actorEmail?: string,
        actorRole?: string
    ) {
        if (!Types.ObjectId.isValid(noteId)) {
            throw AppError.notFound('Sticky note not found');
        }

        const note = await StickyNote.findOne({
            _id: new Types.ObjectId(noteId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });

        if (!note) {
            throw AppError.notFound('Sticky note not found');
        }

        // Prevent duplicate conversion
        if (note.convertedTaskId) {
            throw AppError.conflict('This sticky note has already been converted to a task');
        }

        const effectiveProjectId = input.projectId || (note.projectId ? note.projectId.toString() : null);
        if (!effectiveProjectId) {
            throw AppError.badRequest('Project selection is required to convert a sticky note into a task');
        }

        // Validate access to project
        await StickyNoteValidationService.validateProjectAccess(companyId, userId, effectiveProjectId);

        // Prepare task creation payload
        const taskTitle = (input.title || note.title || '').trim() || 'Sticky Note Task';
        const taskData: any = {
            projectId: effectiveProjectId,
            title: taskTitle,
            description: input.description !== undefined ? input.description : note.content,
            priority: input.priority || note.priority || 'MEDIUM',
            assignedToId: userId,
            dueDate: input.dueDate || (note.reminderAt ? note.reminderAt.toISOString() : undefined),
            stageId: input.stageId,
            statusId: input.statusId,
            moduleId: input.moduleId,
            checklist: (note.checklist || []).map((item) => ({
                title: item.text,
                isCompleted: item.completed,
            })),
        };

        // Create Task using WorkSphere's TaskService
        const createdTask = await TaskService.createTask(taskData, companyId, userId);

        // Save reference on note
        const createdTaskId = (createdTask as any).id || (createdTask as any)._id;
        note.convertedTaskId = new Types.ObjectId(createdTaskId);
        note.projectId = new Types.ObjectId(effectiveProjectId);
        await note.save();

        AuditLogService.log({
            action: AuditAction.STICKY_NOTE_CONVERTED_TO_TASK,
            actorId: userId,
            actorEmail: actorEmail || null,
            actorRole: actorRole || null,
            companyId,
            metadata: {
                noteId: note._id.toString(),
                taskId: String(createdTaskId),
                projectId: effectiveProjectId,
            },
            description: `Sticky note converted to task ${createdTaskId}`,
            success: true,
        });

        const populated = await StickyNote.findById(note._id)
            .populate('projectId', 'name')
            .populate('taskId', 'title taskNumber')
            .lean();

        return {
            note: this.mapNoteResponse(populated || note),
            task: createdTask,
        };
    }

    // ─── Statistics API ───────────────────────────────────────────────────────
    static async getStatistics(userId: string): Promise<StickyNoteStats> {
        const userObjId = new Types.ObjectId(userId);
        const now = new Date();

        const [total, active, completed, archived, pinned, upcomingReminders] = await Promise.all([
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null }),
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null, status: StickyNoteStatus.ACTIVE }),
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null, status: StickyNoteStatus.COMPLETED }),
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null, status: StickyNoteStatus.ARCHIVED }),
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null, isPinned: true }),
            StickyNote.countDocuments({ userId: userObjId, deletedAt: null, reminderAt: { $gte: now } }),
        ]);

        return {
            total,
            active,
            completed,
            archived,
            pinned,
            upcomingReminders,
        };
    }
}
