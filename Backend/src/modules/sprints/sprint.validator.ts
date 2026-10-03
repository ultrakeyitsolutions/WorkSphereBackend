import { z } from 'zod';
import { SprintStatus } from './sprint.types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const idSchema = z.string().regex(objectIdRegex, 'Invalid MongoDB ObjectId');

export const sprintParamSchema = z.object({
    params: z.object({
        projectId: idSchema,
        sprintId: idSchema.optional(),
    }),
});

export const createSprintSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    body: z
        .object({
            name: z.string().trim().min(2, 'Sprint name must be at least 2 characters').max(200, 'Name cannot exceed 200 characters'),
            description: z.string().trim().max(3000, 'Description cannot exceed 3000 characters').optional().nullable(),
            goal: z.string().trim().max(1000, 'Goal cannot exceed 1000 characters').optional().nullable(),
            startDate: z.string().or(z.date()).transform((val) => new Date(val)),
            endDate: z.string().or(z.date()).transform((val) => new Date(val)),
            status: z.nativeEnum(SprintStatus).optional().default(SprintStatus.PLANNED),
        })
        .refine((data) => data.startDate < data.endDate, {
            message: 'startDate must be strictly before endDate',
            path: ['endDate'],
        }),
});

export const updateSprintSchema = z.object({
    params: z.object({
        projectId: idSchema,
        sprintId: idSchema,
    }),
    body: z
        .object({
            name: z.string().trim().min(2).max(200).optional(),
            description: z.string().trim().max(3000).optional().nullable(),
            goal: z.string().trim().max(1000).optional().nullable(),
            startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
            endDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
            status: z.nativeEnum(SprintStatus).optional(),
        })
        .refine(
            (data) => {
                if (data.startDate && data.endDate) {
                    return data.startDate < data.endDate;
                }
                return true;
            },
            {
                message: 'startDate must be strictly before endDate',
                path: ['endDate'],
            }
        ),
});

export const listSprintSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
        status: z.nativeEnum(SprintStatus).optional(),
        startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        sortBy: z.enum(['startDate', 'endDate', 'createdAt', 'name', 'status']).default('startDate'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
});

export const sprintTasksQuerySchema = z.object({
    params: z.object({
        projectId: idSchema,
        sprintId: idSchema,
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        status: z.string().trim().optional(),
        statusId: idSchema.optional(),
        stageId: idSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        assigneeId: idSchema.optional(),
        assignedToId: idSchema.optional(),
        search: z.string().trim().optional(),
    }),
});

export const updateSprintTaskStatusSchema = z.object({
    params: z.object({
        projectId: idSchema,
        sprintId: idSchema,
        taskId: idSchema,
    }),
    body: z.object({
        status: z.string().trim().min(1, 'Status is required'),
        stageId: idSchema.optional(),
        statusId: idSchema.optional(),
        progress: z.number().min(0).max(100).optional(),
    }),
});

