import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

export const createBugSchema = z.object({
    params: z.object({
        taskId: idSchema
    }),
    body: z.object({
        title: z.string().min(1, 'Title is required'),
        description: z.string().optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW'),
        assignedTo: idSchema.optional()
    })
});

export const updateBugSchema = z.object({
    params: z.object({
        bugId: idSchema
    }),
    body: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED']).optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        assignedTo: idSchema.optional()
    })
});

export const bugParamSchema = z.object({
    params: z.object({
        bugId: idSchema
    })
});
