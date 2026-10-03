import { z } from 'zod';
import { ReleaseStatus } from './release.types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const idSchema = z.string().regex(objectIdRegex, 'Invalid MongoDB ObjectId');

export const releaseParamSchema = z.object({
    params: z.object({
        projectId: idSchema,
        releaseId: idSchema.optional(),
    }),
});

export const createReleaseSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    body: z
        .object({
            name: z.string().trim().min(2, 'Release name must be at least 2 characters').max(200, 'Name cannot exceed 200 characters'),
            version: z.string().trim().min(1, 'Version is required').max(50, 'Version cannot exceed 50 characters'),
            description: z.string().trim().max(3000, 'Description cannot exceed 3000 characters').optional().nullable(),
            startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),
            targetDate: z.string().or(z.date()).transform((val) => new Date(val)),
            status: z.nativeEnum(ReleaseStatus).optional().default(ReleaseStatus.PLANNED),
            releaseNotes: z.string().trim().max(10000).optional().nullable(),
            sprintIds: z.array(idSchema).optional(),
        })
        .refine(
            (data) => {
                if (data.startDate && data.targetDate) {
                    return data.startDate <= data.targetDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before targetDate',
                path: ['targetDate'],
            }
        ),
});

export const updateReleaseSchema = z.object({
    params: z.object({
        projectId: idSchema,
        releaseId: idSchema,
    }),
    body: z
        .object({
            name: z.string().trim().min(2).max(200).optional(),
            version: z.string().trim().min(1).max(50).optional(),
            description: z.string().trim().max(3000).optional().nullable(),
            startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),
            targetDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
            status: z.nativeEnum(ReleaseStatus).optional(),
            releaseNotes: z.string().trim().max(10000).optional().nullable(),
            sprintIds: z.array(idSchema).optional(),
        })
        .refine(
            (data) => {
                if (data.startDate && data.targetDate) {
                    return data.startDate <= data.targetDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before targetDate',
                path: ['targetDate'],
            }
        ),
});

export const listReleaseSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
        version: z.string().trim().optional(),
        status: z.nativeEnum(ReleaseStatus).optional(),
        startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        targetDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        sortBy: z.enum(['targetDate', 'startDate', 'createdAt', 'name', 'version', 'status']).default('targetDate'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
});

export const releaseVersionBodySchema = z.object({
    params: z.object({
        projectId: idSchema,
        releaseId: idSchema,
    }),
    body: z.object({
        releaseNotes: z.string().trim().max(10000).optional().nullable(),
        releasedAt: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
    }).optional(),
});

export const releaseTasksQuerySchema = z.object({
    params: z.object({
        projectId: idSchema,
        releaseId: idSchema,
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        statusId: idSchema.optional(),
        stageId: idSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        assignedToId: idSchema.optional(),
        sprintId: idSchema.optional(),
        search: z.string().trim().optional(),
    }),
});
