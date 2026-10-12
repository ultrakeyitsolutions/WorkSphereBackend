import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID format');

export const getLiveOverviewSchema = z.object({
    query: z.object({
        forceRefresh: z.string().optional().transform(v => v === 'true')
    }).optional()
});

export const getLiveEmployeesSchema = z.object({
    query: z.object({
        search: z.string().optional(),
        teamId: idSchema.optional(),
        departmentId: idSchema.optional(),
        projectId: idSchema.optional(),
        presence: z.enum(['ONLINE', 'OFFLINE']).optional(),
        workStatus: z.enum(['WORKING', 'ON_BREAK', 'IN_MEETING', 'ON_LEAVE', 'IDLE', 'OFFLINE']).optional(),
        taskStatus: z.string().optional(),
        sortBy: z.enum(['lastActivity', 'name', 'status', 'recent']).default('lastActivity'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        pageSize: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100))
    }).optional()
});

export const getLiveEmployeeDetailSchema = z.object({
    params: z.object({
        employeeId: idSchema
    })
});

export const getLiveActivitySchema = z.object({
    query: z.object({
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '30', 10), 1), 100)),
        eventType: z.string().optional(),
        employeeId: idSchema.optional(),
        projectId: idSchema.optional(),
        from: z.string().optional(),
        to: z.string().optional()
    }).optional()
});

export const getLiveProjectsSchema = z.object({
    query: z.object({
        status: z.string().optional(),
        riskOnly: z.string().optional().transform(v => v === 'true'),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        pageSize: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100))
    }).optional()
});

export const getLiveAttendanceSchema = z.object({
    query: z.object({
        date: z.string().optional(),
        teamId: idSchema.optional(),
        departmentId: idSchema.optional(),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ALL']).optional(),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '30', 10), 1), 100)),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        pageSize: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '30', 10), 1), 100))
    }).optional()
});

export const getLiveAlertsSchema = z.object({
    query: z.object({
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        alertType: z.string().optional(),
        status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        pageSize: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100))
    }).optional()
});

export const acknowledgeAlertSchema = z.object({
    params: z.object({
        alertId: idSchema
    }),
    body: z.object({
        note: z.string().max(500).optional()
    }).optional()
});

export const resolveAlertSchema = z.object({
    params: z.object({
        alertId: idSchema
    }),
    body: z.object({
        note: z.string().max(500).optional(),
        resolutionReason: z.string().max(200).optional()
    }).optional()
});
