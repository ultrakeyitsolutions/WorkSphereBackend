import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdPattern, { message: 'Invalid ObjectId' });

const recurrenceSchema = z.object({
    type: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().min(1).default(1),
    daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    dayOfMonth: z.number().min(1).max(31).optional(),
    startDate: z.string().or(z.date()).transform((val) => new Date(val)),
    endDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),
    maxOccurrences: z.number().optional().nullable(),
    useSpecificTime: z.boolean().default(false),
    startTime: z.string().optional(),
    endTime: z.string().optional()
});

export const createTaskSchema = z.object({
    body: z.object({
        projectId: objectIdSchema,
        moduleId: objectIdSchema.optional(),
        title: z.string().min(1, 'Task title is required'),
        description: z.string().optional(),
        assignedToId: objectIdSchema.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
        criticality: z.number().optional(),
        startDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
        deliveryDate: z.string().or(z.date()).transform((val) => new Date(val)).optional().nullable(),
        estimatedHours: z.number().min(0).optional(),
        tags: z.array(z.string()).optional(),

        isRecurring: z.boolean().default(false),
        recurrence: recurrenceSchema.optional()
    }).refine(data => {
        if (data.isRecurring && !data.recurrence) {
            return false;
        }
        return true;
    }, { message: 'Recurrence configuration is required for recurring tasks' })
});
