import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID format');

// ─── GET /api/v1/company/detailed-monitoring/employees ──────────────────────
export const getDetailedEmployeesSchema = z.object({
    query: z.object({
        search: z.string().optional(),
        departmentId: idSchema.optional(),
        roleId: idSchema.optional(),
        projectId: idSchema.optional(),
        presence: z.enum(['ONLINE', 'OFFLINE']).optional(),
        attendanceStatus: z.string().optional(),
        workStatus: z.enum(['WORKING', 'ON_BREAK', 'IN_MEETING', 'ON_LEAVE', 'IDLE', 'OFFLINE', 'NOT_RECORDED']).optional(),
        taskStatus: z.string().optional(),
        sortBy: z.enum(['lastActivity', 'name', 'status', 'joinedAt', 'alerts']).default('lastActivity'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        pageSize: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/profile ──
export const getEmployeeProfileSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/overview ─
export const getEmployeeOverviewSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        dateRange: z.enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_3_MONTHS', 'CUSTOM']).optional().default('TODAY'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/attendance
export const getEmployeeAttendanceSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        month: z.string().optional(),
        year: z.string().optional(),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '31', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/projects ─
export const getEmployeeProjectsSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED', 'ON_HOLD', 'ALL']).optional().default('ALL'),
        search: z.string().optional(),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/tasks ────
export const getEmployeeTasksSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        projectId: idSchema.optional(),
        sprintId: idSchema.optional(),
        isBlocked: z.string().optional().transform(v => v === 'true'),
        isOverdue: z.string().optional().transform(v => v === 'true'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        search: z.string().optional(),
        sortBy: z.enum(['updatedAt', 'createdAt', 'deliveryDate', 'priority', 'status', 'progress']).default('updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/meetings ─
export const getEmployeeMeetingsSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        search: z.string().optional(),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/timeline ─
export const getEmployeeTimelineSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        eventType: z.string().optional(),
        projectId: idSchema.optional(),
        taskId: idSchema.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '30', 10), 1), 100)),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/analytics 
export const getEmployeeAnalyticsSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        dateRange: z.enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_3_MONTHS', 'CUSTOM']).optional().default('LAST_30_DAYS'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/alerts ───
export const getEmployeeAlertsSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'ALL']).optional().default('ALL'),
        severity: z.string().optional(),
        page: z.string().optional().transform(v => Math.max(parseInt(v || '1', 10), 1)),
        limit: z.string().optional().transform(v => Math.min(Math.max(parseInt(v || '20', 10), 1), 100)),
    }).optional(),
});

// ─── PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/acknowledge ───
export const acknowledgeEmployeeAlertSchema = z.object({
    params: z.object({
        alertId: idSchema,
    }),
    body: z.object({
        note: z.string().optional(),
    }).optional(),
});

// ─── PATCH /api/v1/company/detailed-monitoring/alerts/:alertId/resolve ───────
export const resolveEmployeeAlertSchema = z.object({
    params: z.object({
        alertId: idSchema,
    }),
    body: z.object({
        note: z.string().optional(),
        resolutionReason: z.string().optional(),
    }).optional(),
});

// ─── GET /api/v1/company/detailed-monitoring/employees/:employeeId/export ───
export const exportEmployeeReportSchema = z.object({
    params: z.object({
        employeeId: idSchema,
    }),
    query: z.object({
        type: z.enum(['ATTENDANCE', 'TIME_TRACKING', 'PROJECTS', 'TASKS', 'MEETINGS', 'ACTIVITY', 'WORKLOAD_SUMMARY']).default('WORKLOAD_SUMMARY'),
        format: z.enum(['csv', 'json']).default('csv'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    }).optional(),
});
