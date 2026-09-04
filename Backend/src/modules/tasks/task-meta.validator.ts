import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

// ─── MODULES ─────────────────────────────────────────────────────────────────
export const createModuleSchema = z.object({
    params: z.object({ projectId: idSchema }),
    body: z.object({
        name: z.string().min(1, 'Module name is required'),
        description: z.string().optional()
    })
});

export const updateModuleSchema = z.object({
    params: z.object({ projectId: idSchema, moduleId: idSchema }),
    body: z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        orderIndex: z.number().int().optional(),
        isActive: z.boolean().optional()
    })
});

// ─── STAGES ──────────────────────────────────────────────────────────────────
export const createStageSchema = z.object({
    params: z.object({ projectId: idSchema }),
    body: z.object({
        name: z.string().min(1, 'Stage name is required'),
        color: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color').optional(),
        orderIndex: z.number().int().optional()
    })
});

export const updateStageSchema = z.object({
    params: z.object({ projectId: idSchema, stageId: idSchema }),
    body: z.object({
        name: z.string().min(1).optional(),
        color: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color').optional(),
        orderIndex: z.number().int().optional(),
        isActive: z.boolean().optional()
    })
});

// ─── STATUSES ────────────────────────────────────────────────────────────────
export const createStatusSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Status name is required'),
        color: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color').optional(),
        orderIndex: z.number().int().optional()
    })
});

export const updateStatusSchema = z.object({
    params: z.object({ statusId: idSchema }),
    body: z.object({
        name: z.string().min(1).optional(),
        color: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color').optional(),
        orderIndex: z.number().int().optional(),
        isActive: z.boolean().optional()
    })
});

// ─── TEMPLATES ───────────────────────────────────────────────────────────────
export const createTaskTemplateSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Template name is required'),
        description: z.string().optional(),
        designationId: idSchema.optional(),

        moduleId: idSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        taskType: z.string().optional(),
        criticality: z.enum(['NON_CRITICAL', 'CRITICAL']).optional(),
        estimatedTime: z.object({
            hours: z.number().min(0).default(0),
            minutes: z.number().min(0).max(59).default(0)
        }).optional(),
        tags: z.array(z.string()).optional(),
        notes: z.array(z.object({ content: z.string().min(1) })).optional(),
        checklist: z.array(z.object({
            title: z.string().min(1),
            isCompleted: z.boolean().default(false)
        })).optional()
    })
});

export const updateTaskTemplateSchema = z.object({
    params: z.object({ templateId: idSchema }),
    body: createTaskTemplateSchema.shape.body.partial().extend({
        isActive: z.boolean().optional()
    })
});

// ─── PARAM SCHEMAS ───────────────────────────────────────────────────────────
export const paramProjectIdSchema = z.object({ params: z.object({ projectId: idSchema }) });
export const paramModuleIdSchema = z.object({ params: z.object({ projectId: idSchema, moduleId: idSchema }) });
export const paramStageIdSchema = z.object({ params: z.object({ projectId: idSchema, stageId: idSchema }) });
export const paramStatusIdSchema = z.object({ params: z.object({ statusId: idSchema }) });
export const paramTemplateIdSchema = z.object({ params: z.object({ templateId: idSchema }) });
