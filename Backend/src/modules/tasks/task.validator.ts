import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

const noteSchema = z.object({
    content: z.string().min(1, 'Note content is required')
});

const attachmentSchema = z.object({
    fileName: z.string(),
    fileUrl: z.string(),
    fileType: z.string().optional(),
    fileSize: z.number().optional()
});

const checklistItemSchema = z.object({
    _id: z.string().optional(),
    id: z.string().optional(),
    title: z.string().min(1),
    isCompleted: z.boolean().default(false),
    notes: z.string().optional().nullable(),
    completedById: z.string().optional().nullable(),
    completedAt: z.string().or(z.date()).optional().nullable()
});

const estimatedTimeSchema = z.object({
    hours: z.number().min(0).default(0),
    minutes: z.number().min(0).max(59).default(0)
});

// ─── Recurrence Sub-Schema ────────────────────────────────────────────────────
const recurrenceBaseSchema = z.object({
    pattern: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    repeatEvery: z.number().min(1).default(1),
    daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    dayOfMonth: z.number().min(1).max(31).optional(),
    month: z.number().min(1).max(12).optional(),

    startDateTime: z.string().or(z.date()).transform((val) => new Date(val)),
    endDateTime: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),
    maxOccurrences: z.number().optional().nullable(),

    // Recurring-specific task properties
    moduleId: idSchema.optional(),
    assignedToId: idSchema.optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    taskType: z.string().optional(),
    criticality: z.enum(['NON_CRITICAL', 'CRITICAL']).optional(),
    estimatedTime: estimatedTimeSchema.optional(),
    tags: z.array(z.string()).optional(),
    notes: z.array(noteSchema).optional(),
    attachments: z.array(attachmentSchema).optional(),
    checklist: z.array(checklistItemSchema).optional(),
    templateId: idSchema.optional()
});

const recurrenceSchema = recurrenceBaseSchema.refine(data => {
    if (data.endDateTime && data.startDateTime > data.endDateTime) return false;
    return true;
}, { message: 'endDateTime must be >= startDateTime', path: ['endDateTime'] });

// ─── Create Task ─────────────────────────────────────────────────────────────
export const createTaskSchema = z.object({
    body: z.object({
        projectId: idSchema,
        moduleId: idSchema.optional(),

        title: z.string().min(1, 'Task title is required'),
        ticketId: z.string().optional().nullable(),
        taskType: z.string().default('TASK'),
        criticality: z.enum(['NON_CRITICAL', 'CRITICAL']).default('NON_CRITICAL'),

        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),

        startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
        deliveryDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),

        estimatedTime: estimatedTimeSchema.optional(),

        tags: z.array(z.string()).optional(),
        notes: z.array(noteSchema).optional(),
        attachments: z.array(attachmentSchema).optional(),
        checklist: z.array(checklistItemSchema).optional(),

        isUseTemplate: z.boolean().default(false),
        templateId: idSchema.optional().nullable(),

        assignedToId: idSchema.optional(),

        isRecurring: z.boolean().default(false),
        recurrence: recurrenceSchema.optional()
    }).refine(data => {
        if (data.isRecurring && !data.recurrence) return false;
        return true;
    }, { message: 'Recurrence configuration is required for recurring tasks' })
});

// ─── Update Task ─────────────────────────────────────────────────────────────
export const updateTaskSchema = z.object({
    params: z.object({ taskId: idSchema }),
    body: z.object({
        moduleId: idSchema.optional(),
        title: z.string().min(1).optional(),
        ticketId: z.string().optional().nullable(),
        taskType: z.string().optional(),
        criticality: z.enum(['NON_CRITICAL', 'CRITICAL']).optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        stageId: idSchema.optional(),

        startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
        deliveryDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),

        estimatedTime: estimatedTimeSchema.optional(),
        progress: z.number().min(0).max(100).optional(),

        tags: z.array(z.string()).optional(),
        notes: z.array(noteSchema).optional(),
        attachments: z.array(attachmentSchema).optional(),
        checklist: z.array(checklistItemSchema).optional(),

        assignedToId: idSchema.optional(),

        isRecurring: z.boolean().optional(),
        recurrence: recurrenceSchema.optional()
    })
});

// ─── Update Recurrence ────────────────────────────────────────────────────────
export const updateRecurrenceSchema = z.object({
    params: z.object({ taskId: idSchema }),
    body: recurrenceBaseSchema.partial().refine(data => {
        if (data.startDateTime && data.endDateTime && data.startDateTime > data.endDateTime) return false;
        return true;
    }, { message: 'endDateTime must be >= startDateTime', path: ['endDateTime'] })
});

// ─── Param only ───────────────────────────────────────────────────────────────
export const taskParamSchema = z.object({
    params: z.object({ taskId: idSchema })
});

export const projectTaskListSchema = z.object({
    params: z.object({ projectId: idSchema }),
    query: z.object({
        page: z.string().optional().transform(v => parseInt(v || '1', 10)),
        pageSize: z.string().optional().transform(v => parseInt(v || '50', 10)),
        stageId: idSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        isRecurring: z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
        isArchived: z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
        archived: z.string().optional().transform(v => v === 'true' ? true : v === 'false' ? false : undefined),
        search: z.string().optional()
    }).optional()
});

export const archivedTaskListSchema = z.object({
    query: z.object({
        projectId: idSchema.optional(),
        page: z.string().optional().transform(v => parseInt(v || '1', 10)),
        pageSize: z.string().optional().transform(v => parseInt(v || '50', 10)),
        limit: z.string().optional().transform(v => parseInt(v || '50', 10)),
        search: z.string().optional(),
        stageId: idSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        assignedToId: idSchema.optional()
    }).optional()
});

// ─── Reopen Task ──────────────────────────────────────────────────────────
export const reopenTaskSchema = z.object({
    params: z.object({ taskId: idSchema }),
    body: z.object({
        reopenReason: z.string().min(1, 'Reopen reason is required'),
        assignedToId: idSchema.optional()
    })
});

// ─── Project Members Param ──────────────────────────────────────────────────
export const projectMembersParamSchema = z.object({
    params: z.object({ projectId: idSchema })
});

// ─── Cancel Task ────────────────────────────────────────────────────────────
export const cancelTaskSchema = z.object({
    params: z.object({ taskId: idSchema }),
    body: z.object({
        reason: z.string().optional()
    }).optional()
});

