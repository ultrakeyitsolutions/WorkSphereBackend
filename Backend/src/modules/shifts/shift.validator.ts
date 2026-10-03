import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
export const idSchema = z.string().regex(objectIdRegex, 'Invalid MongoDB ObjectId');
const timeFormatRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const createShiftSchema = z.object({
    body: z.object({
        name: z.string().trim().min(2, 'Shift name must be at least 2 characters').max(100),
        code: z.string().trim().min(1, 'Shift code is required').max(50),
        startTime: z.string().regex(timeFormatRegex, 'Start time must be in HH:mm 24-hour format (e.g. 09:00, 22:00)'),
        endTime: z.string().regex(timeFormatRegex, 'End time must be in HH:mm 24-hour format (e.g. 17:30, 06:00)'),
        timezone: z.string().trim().optional().default('Asia/Kolkata'),
        gracePeriodMinutes: z.number().min(0).max(240).optional().default(10),
        earlyCheckoutGracePeriodMinutes: z.number().min(0).max(240).optional().default(5),
        workingDays: z.array(z.number().min(1).max(7)).optional().default([1, 2, 3, 4, 5]),
        halfDayThresholdMinutes: z.number().min(0).optional().default(240),
        fullDayThresholdMinutes: z.number().min(0).optional().default(480),
        isActive: z.boolean().optional().default(true),
        isDefault: z.boolean().optional().default(false),
        description: z.string().trim().max(500).optional().default(''),
    }),
});

export const updateShiftSchema = z.object({
    params: z.object({
        shiftId: idSchema,
    }),
    body: z.object({
        name: z.string().trim().min(2).max(100).optional(),
        code: z.string().trim().min(1).max(50).optional(),
        startTime: z.string().regex(timeFormatRegex, 'Start time must be in HH:mm 24-hour format').optional(),
        endTime: z.string().regex(timeFormatRegex, 'End time must be in HH:mm 24-hour format').optional(),
        timezone: z.string().trim().optional(),
        gracePeriodMinutes: z.number().min(0).max(240).optional(),
        earlyCheckoutGracePeriodMinutes: z.number().min(0).max(240).optional(),
        workingDays: z.array(z.number().min(1).max(7)).optional(),
        halfDayThresholdMinutes: z.number().min(0).optional(),
        fullDayThresholdMinutes: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        description: z.string().trim().max(500).optional(),
    }),
});

export const shiftParamSchema = z.object({
    params: z.object({
        shiftId: idSchema,
    }),
});

export const listShiftQuerySchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        search: z.string().optional(),
        isActive: z.string().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
});

export const assignShiftSchema = z.object({
    body: z.object({
        employeeId: idSchema,
        shiftId: idSchema,
        effectiveFrom: z.string().or(z.date()),
        effectiveTo: z.string().or(z.date()).optional().nullable(),
        reason: z.string().trim().max(500).optional().nullable(),
    }),
});

export const bulkAssignShiftSchema = z.object({
    body: z.object({
        employeeIds: z.array(idSchema).min(1, 'Please select at least one employee'),
        shiftId: idSchema,
        effectiveFrom: z.string().or(z.date()),
        effectiveTo: z.string().or(z.date()).optional().nullable(),
        reason: z.string().trim().max(500).optional().nullable(),
    }),
});

export const listShiftAssignmentQuerySchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        search: z.string().optional(),
        shiftId: idSchema.optional(),
        employeeId: idSchema.optional(),
        status: z.enum(['ACTIVE', 'SCHEDULED', 'EXPIRED', 'CANCELLED']).optional(),
        date: z.string().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
});

export const employeeParamSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
});
