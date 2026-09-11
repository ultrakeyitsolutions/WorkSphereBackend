import { z } from 'zod';
import { ProjectType, ProjectPriority, ProjectStatus } from './project.types';

// ─── Project Settings Schema ──────────────────────────────────────────────────

const projectSettingsSchema = z.object({
    allowTeamMembersToCreateTasks: z.boolean().optional().default(true),
    showTaskItemNumber: z.boolean().optional().default(true),
    allowExplanation: z.boolean().optional().default(true),
    deliveryDateMandatory: z.boolean().optional().default(false),
    isConfidential: z.boolean().optional().default(false),
    enableTemplateHierarchy: z.boolean().optional().default(false),
}).optional();

// ─── Shared: projectId param ──────────────────────────────────────────────────

const projectIdParam = z.object({
    projectId: z.string().min(1, 'projectId is required'),
});

// ─── Create Project Schema ────────────────────────────────────────────────────

export const createProjectBodySchema = z.object({
    name: z
        .string({ error: 'Project name is required' })
        .trim()
        .min(2, 'Project name must be at least 2 characters')
        .max(150, 'Project name must not exceed 150 characters')
        .refine((v) => v.trim().length > 0, 'Project name cannot be empty or whitespace'),

    description: z
        .string()
        .trim()
        .max(2000, 'Description must not exceed 2000 characters')
        .optional(),

    type: z.enum(
        Object.values(ProjectType) as [string, ...string[]]
    ),

    priority: z.enum(
        Object.values(ProjectPriority) as [string, ...string[]]
    ),

    startDate: z
        .string({ error: 'Start date is required' })
        .refine((d) => !isNaN(Date.parse(d)), 'startDate must be a valid date'),

    endDate: z
        .string({ error: 'End date is required' })
        .refine((d) => !isNaN(Date.parse(d)), 'endDate must be a valid date'),

    projectManagerId: z
        .string({ error: 'Project manager ID is required' })
        .trim()
        .min(1, 'projectManagerId is required'),

    teamMemberIds: z
        .array(z.string().trim().min(1))
        .optional()
        .default([]),

    clientIds: z
        .array(z.string().trim().min(1))
        .optional()
        .default([]),

    settings: projectSettingsSchema,
}).refine(
    (data) => {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        return end >= start;
    },
    {
        message: 'endDate must not be earlier than startDate',
        path: ['endDate'],
    }
);

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const createProjectSchema = z.object({
    body: createProjectBodySchema,
});

// ─── Update Project Schema ────────────────────────────────────────────────────

export const updateProjectBodySchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, 'Project name must be at least 2 characters')
        .max(150, 'Project name must not exceed 150 characters')
        .optional(),

    description: z
        .string()
        .trim()
        .max(2000, 'Description must not exceed 2000 characters')
        .optional(),

    type: z.enum(
        Object.values(ProjectType) as [string, ...string[]]
    ).optional(),

    priority: z.enum(
        Object.values(ProjectPriority) as [string, ...string[]]
    ).optional(),

    status: z.enum(
        Object.values(ProjectStatus) as [string, ...string[]]
    ).optional(),

    startDate: z
        .string()
        .refine((d) => !isNaN(Date.parse(d)), 'startDate must be a valid date')
        .optional(),

    endDate: z
        .string()
        .refine((d) => !isNaN(Date.parse(d)), 'endDate must be a valid date')
        .optional(),

    projectManagerId: z
        .string()
        .trim()
        .min(1, 'projectManagerId must not be empty')
        .optional(),

    teamMemberIds: z
        .array(z.string().trim().min(1))
        .optional(),

    clientIds: z
        .array(z.string().trim().min(1))
        .optional(),

    settings: projectSettingsSchema,
}).refine(
    (data) => {
        if (data.startDate && data.endDate) {
            return new Date(data.endDate) >= new Date(data.startDate);
        }
        return true;
    },
    {
        message: 'endDate must not be earlier than startDate',
        path: ['endDate'],
    }
);

export const updateProjectSchema = z.object({
    body: updateProjectBodySchema,
    params: projectIdParam,
});

export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

// ─── List Projects Schema ─────────────────────────────────────────────────────

export const listProjectsSchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        search: z.string().optional(),
        isPinned: z.string().optional(),
    }).optional(),
});

// ─── Simple param-only schemas (archive, unarchive, delete, pin, unpin, status) ─

export const projectParamSchema = z.object({
    params: projectIdParam,
});
