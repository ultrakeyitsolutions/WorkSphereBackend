import { z } from 'zod';
import { Types } from 'mongoose';
import {
    StickyNoteColor,
    StickyNotePriority,
    StickyNoteStatus,
    MAX_TITLE_LENGTH,
    MAX_CONTENT_LENGTH,
    MAX_TAGS_COUNT,
    MAX_CHECKLIST_ITEMS,
    ALLOWED_SORT_FIELDS,
} from './sticky-note.constants';
import { Project } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { Task } from '../tasks/task.model';
import { AppError } from '../../utils/AppError';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const objectIdSchema = z
    .string()
    .trim()
    .refine((val) => Types.ObjectId.isValid(val), {
        message: 'Invalid ObjectId format',
    });

const checklistItemInputSchema = z.object({
    id: z.string().optional(),
    text: z.string().trim().min(1, 'Checklist item text cannot be empty').max(500, 'Checklist item text cannot exceed 500 characters'),
    completed: z.boolean().optional().default(false),
    completedAt: z.union([z.string().datetime(), z.date()]).optional().nullable(),
});

export const createStickyNoteSchema = z.object({
    title: z.string().trim().max(MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`).optional().default(''),
    content: z.string().min(1, 'Content is required').max(MAX_CONTENT_LENGTH, `Content cannot exceed ${MAX_CONTENT_LENGTH} characters`),
    color: z.nativeEnum(StickyNoteColor).optional().default(StickyNoteColor.YELLOW),
    priority: z.nativeEnum(StickyNotePriority).optional().default(StickyNotePriority.MEDIUM),
    tags: z
        .array(z.string().trim().min(1).max(50))
        .max(MAX_TAGS_COUNT, `Cannot have more than ${MAX_TAGS_COUNT} tags`)
        .optional()
        .default([]),
    isPinned: z.boolean().optional().default(false),
    checklist: z
        .array(checklistItemInputSchema)
        .max(MAX_CHECKLIST_ITEMS, `Cannot have more than ${MAX_CHECKLIST_ITEMS} checklist items`)
        .optional()
        .default([]),
    projectId: z.union([objectIdSchema, z.null()]).optional(),
    taskId: z.union([objectIdSchema, z.null()]).optional(),
    reminderAt: z
        .union([
            z.string().datetime({ message: 'reminderAt must be a valid ISO-8601 date string' }),
            z.date(),
            z.null(),
        ])
        .optional(),
});

export const updateStickyNoteSchema = z.object({
    title: z.string().trim().max(MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`).optional(),
    content: z.string().min(1, 'Content cannot be empty').max(MAX_CONTENT_LENGTH, `Content cannot exceed ${MAX_CONTENT_LENGTH} characters`).optional(),
    color: z.nativeEnum(StickyNoteColor).optional(),
    priority: z.nativeEnum(StickyNotePriority).optional(),
    tags: z
        .array(z.string().trim().min(1).max(50))
        .max(MAX_TAGS_COUNT, `Cannot have more than ${MAX_TAGS_COUNT} tags`)
        .optional(),
    isPinned: z.boolean().optional(),
    checklist: z
        .array(checklistItemInputSchema)
        .max(MAX_CHECKLIST_ITEMS, `Cannot have more than ${MAX_CHECKLIST_ITEMS} checklist items`)
        .optional(),
    projectId: z.union([objectIdSchema, z.null()]).optional(),
    taskId: z.union([objectIdSchema, z.null()]).optional(),
    reminderAt: z
        .union([
            z.string().datetime({ message: 'reminderAt must be a valid ISO-8601 date string' }),
            z.date(),
            z.null(),
        ])
        .optional(),
});

export const pinStickyNoteSchema = z.object({
    isPinned: z.boolean({ message: 'isPinned boolean is required' }),
});

export const completeStickyNoteSchema = z.object({
    completed: z.boolean().optional().default(true),
});

export const convertToTaskSchema = z.object({
    projectId: objectIdSchema.optional(),
    title: z.string().trim().max(200).optional(),
    description: z.string().max(50000).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    dueDate: z.string().optional(),
    stageId: objectIdSchema.optional(),
    statusId: objectIdSchema.optional(),
    moduleId: z.string().optional(),
});

export const queryStickyNotesSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(),
    status: z.nativeEnum(StickyNoteStatus).optional(),
    priority: z.nativeEnum(StickyNotePriority).optional(),
    color: z.nativeEnum(StickyNoteColor).optional(),
    isPinned: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((v) => (typeof v === 'string' ? v === 'true' : v))
        .optional(),
    tag: z.string().trim().optional(),
    projectId: objectIdSchema.optional(),
    taskId: objectIdSchema.optional(),
    sortBy: z
        .string()
        .refine((val) => (ALLOWED_SORT_FIELDS as readonly string[]).includes(val), {
            message: `sortBy must be one of: ${ALLOWED_SORT_FIELDS.join(', ')}`,
        })
        .optional()
        .default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const upcomingRemindersQuerySchema = z.object({
    timeframe: z.enum(['today', 'tomorrow', 'this-week', 'all']).optional().default('this-week'),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Service Validation & Security Logic ───────────────────────────────────────

export class StickyNoteValidationService {
    /**
     * Verify that the project exists, is not deleted/archived, and the user has access.
     */
    static async validateProjectAccess(
        companyId: string,
        userId: string,
        projectId: string | Types.ObjectId
    ): Promise<boolean> {
        const pId = projectId.toString();
        if (!Types.ObjectId.isValid(pId)) {
            throw AppError.unprocessable('Invalid project ID format');
        }

        const project = await Project.findOne({
            _id: new Types.ObjectId(pId),
            isArchived: { $ne: true },
            deletedAt: null,
        }).lean();

        if (!project) {
            throw AppError.notFound('Project not found or inactive');
        }

        const effectiveCompanyId = companyId || (project.companyId ? project.companyId.toString() : '');
        const canAccess = await ProjectService.canAccessProject(effectiveCompanyId, userId, pId);
        if (!canAccess) {
            throw AppError.forbidden('You do not have access to this project');
        }

        return true;
    }

    /**
     * Verify that the task exists, belongs to an authorized project, and is accessible.
     */
    static async validateTaskAccess(
        companyId: string,
        userId: string,
        taskId: string | Types.ObjectId,
        expectedProjectId?: string | Types.ObjectId | null
    ): Promise<boolean> {
        const tId = taskId.toString();
        if (!Types.ObjectId.isValid(tId)) {
            throw AppError.unprocessable('Invalid task ID format');
        }

        const task = await Task.findOne({
            _id: new Types.ObjectId(tId),
            isArchived: { $ne: true },
            deletedAt: null,
        }).lean();

        if (!task) {
            throw AppError.notFound('Task not found or inactive');
        }

        // If a projectId was also provided, ensure the task belongs to it
        if (expectedProjectId) {
            const expId = expectedProjectId.toString();
            if (task.projectId.toString() !== expId) {
                throw AppError.conflict('The specified task does not belong to the provided project');
            }
        }

        // Validate access to the task's project
        const effectiveCompanyId = companyId || (task.companyId ? task.companyId.toString() : '');
        const canAccess = await ProjectService.canAccessProject(effectiveCompanyId, userId, task.projectId.toString());
        if (!canAccess) {
            throw AppError.forbidden('You do not have access to the project associated with this task');
        }

        return true;
    }
}
