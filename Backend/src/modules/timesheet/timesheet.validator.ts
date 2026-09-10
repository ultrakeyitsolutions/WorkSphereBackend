import { z } from 'zod';

// ─── Shared ───────────────────────────────────────────────────────────────────

const dateStringSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a valid date in YYYY-MM-DD format');

const optionalObjectId = z
    .string()
    .min(1, 'Invalid ID')
    .optional();

// ─── Main Timesheet Query ─────────────────────────────────────────────────────

export const timesheetQuerySchema = z.object({
    query: z.object({
        startDate:  dateStringSchema,
        endDate:    dateStringSchema,
        employeeId: optionalObjectId,
        projectId:  optionalObjectId,
        page:       z.coerce.number().int().min(1).default(1),
        pageSize:   z.coerce.number().int().min(1).max(100).default(20)
    }).refine(data => data.startDate <= data.endDate, {
        message: 'startDate must be on or before endDate',
        path: ['startDate']
    })
});

export type TimesheetQueryInput = z.infer<typeof timesheetQuerySchema>['query'];

// ─── Trend ────────────────────────────────────────────────────────────────────

export const trendQuerySchema = z.object({
    query: z.object({
        startDate:  dateStringSchema,
        endDate:    dateStringSchema,
        employeeId: optionalObjectId,
        projectId:  optionalObjectId
    }).refine(data => data.startDate <= data.endDate, {
        message: 'startDate must be on or before endDate',
        path: ['startDate']
    })
});

// ─── Period Comparison ────────────────────────────────────────────────────────

export const comparisonQuerySchema = z.object({
    query: z.object({
        currentStart:  dateStringSchema,
        currentEnd:    dateStringSchema,
        previousStart: dateStringSchema,
        previousEnd:   dateStringSchema,
        employeeId:    optionalObjectId
    }).refine(data => data.currentStart <= data.currentEnd, {
        message: 'currentStart must be on or before currentEnd',
        path: ['currentStart']
    }).refine(data => data.previousStart <= data.previousEnd, {
        message: 'previousStart must be on or before previousEnd',
        path: ['previousStart']
    })
});

// ─── Project Distribution ─────────────────────────────────────────────────────

export const projectDistributionQuerySchema = z.object({
    query: z.object({
        startDate:  dateStringSchema,
        endDate:    dateStringSchema,
        employeeId: optionalObjectId
    }).refine(data => data.startDate <= data.endDate, {
        message: 'startDate must be on or before endDate',
        path: ['startDate']
    })
});

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const anomaliesQuerySchema = z.object({
    query: z.object({
        startDate:  dateStringSchema,
        endDate:    dateStringSchema,
        employeeId: optionalObjectId
    }).refine(data => data.startDate <= data.endDate, {
        message: 'startDate must be on or before endDate',
        path: ['startDate']
    })
});

// ─── Timeline ─────────────────────────────────────────────────────────────────

export const timelineParamsSchema = z.object({
    params: z.object({
        date: dateStringSchema
    }),
    query: z.object({
        employeeId: optionalObjectId
    })
});

// ─── Submit Timesheet ─────────────────────────────────────────────────────────

export const submitTimesheetSchema = z.object({
    body: z.object({
        periodStart: dateStringSchema,
        periodEnd:   dateStringSchema
    }).refine(data => data.periodStart <= data.periodEnd, {
        message: 'periodStart must be on or before periodEnd',
        path: ['periodStart']
    })
});

// ─── Approve / Lock ───────────────────────────────────────────────────────────

export const approvalParamsSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'Invalid timesheet approval ID')
    })
});

// ─── Reject ───────────────────────────────────────────────────────────────────

export const rejectTimesheetSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'Invalid timesheet approval ID')
    }),
    body: z.object({
        reason: z.string().min(1, 'Rejection reason is required').max(1000)
    })
});

// ─── Correction ───────────────────────────────────────────────────────────────

export const correctionSchema = z.object({
    body: z.object({
        userId:        z.string().min(1, 'userId is required'),
        attendanceId:  optionalObjectId,
        trackingId:    optionalObjectId,
        activityId:    optionalObjectId,
        fieldChanged:  z.string().min(1, 'fieldChanged is required').max(100),
        originalValue: z.any(),
        newValue:      z.any(),
        reason:        z.string().min(1, 'Reason is required').max(2000)
    }).refine(
        data => data.attendanceId || data.trackingId || data.activityId,
        { message: 'One of attendanceId, trackingId, or activityId is required' }
    )
});
