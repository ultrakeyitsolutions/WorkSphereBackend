import { z } from 'zod';
import { Types } from 'mongoose';

const isValidObjectId = (val?: string) => !val || Types.ObjectId.isValid(val);

const periodEnum = z.enum([
    'today',
    'week',
    'this_week',
    'last_7_days',
    'month',
    'this_month',
    'last_month',
    'last_30_days',
    'last_3_months',
    'custom'
]).optional().default('today');

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const validateDateRange = (data: { period?: string; startDate?: string; endDate?: string }) => {
    if (data.period === 'custom') {
        if (!data.startDate || !data.endDate) return false;
        if (!dateRegex.test(data.startDate) || !dateRegex.test(data.endDate)) return false;
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
        if (start > end) return false;
        const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 365) return false;
    }
    return true;
};

// 1. Company Overview
export const companyOverviewQuerySchema = z.object({
    query: z.object({
        period: periodEnum,
        startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional(),
        timezone: z.string().optional(),
        projectId: z.string().refine(isValidObjectId, 'Invalid projectId format').optional(),
    }).refine(validateDateRange, {
        message: 'startDate and endDate are required, startDate must be <= endDate, and range must not exceed 365 days',
        path: ['startDate'],
    }),
});

// 2. Delivery Trends
export const deliveryTrendsQuerySchema = z.object({
    query: z.object({
        period: periodEnum,
        startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional(),
        timezone: z.string().optional(),
        projectId: z.string().refine(isValidObjectId, 'Invalid projectId format').optional(),
        interval: z.enum(['day', 'week', 'month']).optional(),
    }).refine(validateDateRange, {
        message: 'startDate and endDate are required, startDate must be <= endDate, and range must not exceed 365 days',
        path: ['startDate'],
    }),
});

// 3. Project Health
export const projectHealthQuerySchema = z.object({
    query: z.object({
        status: z.enum(['on_track', 'at_risk', 'delayed']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
});

// 4. Team Workload
export const workloadQuerySchema = z.object({
    query: z.object({
        period: periodEnum,
        startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional(),
        timezone: z.string().optional(),
        departmentId: z.string().refine(isValidObjectId, 'Invalid departmentId format').optional(),
        projectId: z.string().refine(isValidObjectId, 'Invalid projectId format').optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(10),
    }).refine(validateDateRange, {
        message: 'startDate and endDate are required, startDate must be <= endDate, and range must not exceed 365 days',
        path: ['startDate'],
    }),
});

// 5. Attention Items
export const attentionQuerySchema = z.object({
    query: z.object({
        limit: z.coerce.number().int().min(1).max(30).default(10),
    }),
});

// 6. Milestones
export const milestonesQuerySchema = z.object({
    query: z.object({
        projectId: z.string().refine(isValidObjectId, 'Invalid projectId format').optional(),
        status: z.enum(['PLANNED', 'IN_PROGRESS', 'READY_TO_SHIP', 'RELEASED', 'CANCELLED']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
});

// 7. Member Overview
export const memberOverviewQuerySchema = z.object({
    query: z.object({
        period: periodEnum,
        startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional(),
        timezone: z.string().optional(),
    }).refine(validateDateRange, {
        message: 'startDate and endDate are required, startDate must be <= endDate, and range must not exceed 365 days',
        path: ['startDate'],
    }),
});

// 8. Member Trends
export const memberTrendsQuerySchema = z.object({
    query: z.object({
        period: periodEnum,
        startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional(),
        timezone: z.string().optional(),
        interval: z.enum(['day', 'week']).optional(),
    }).refine(validateDateRange, {
        message: 'startDate and endDate are required, startDate must be <= endDate, and range must not exceed 365 days',
        path: ['startDate'],
    }),
});

// 9. Member My Work
export const memberMyWorkQuerySchema = z.object({
    query: z.object({
        limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
});
