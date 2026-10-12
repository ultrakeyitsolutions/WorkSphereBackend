import { z } from 'zod';
import { AttendanceStatus } from './attendance.types';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const companyAttendanceSummaryQuerySchema = z.object({
    query: z
        .object({
            date: z
                .string()
                .regex(dateRegex, 'Date must be formatted as YYYY-MM-DD')
                .optional(),
            startDate: z
                .string()
                .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
                .optional(),
            endDate: z
                .string()
                .regex(dateRegex, 'endDate must be formatted as YYYY-MM-DD')
                .optional(),
            departmentId: z.string().optional(),
        })
        .refine(
            (data) => {
                if (data.startDate && data.endDate) {
                    return data.startDate <= data.endDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before endDate',
                path: ['endDate'],
            }
        ),
});

export const lateArrivalsQuerySchema = z.object({
    query: z
        .object({
            date: z
                .string()
                .regex(dateRegex, 'Date must be formatted as YYYY-MM-DD')
                .optional(),
            startDate: z
                .string()
                .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
                .optional(),
            endDate: z
                .string()
                .regex(dateRegex, 'endDate must be formatted as YYYY-MM-DD')
                .optional(),
            limit: z.coerce.number().min(1).max(50).optional().default(5),
            page: z.coerce.number().min(1).optional().default(1),
            departmentId: z.string().optional(),
        })
        .refine(
            (data) => {
                if (data.startDate && data.endDate) {
                    return data.startDate <= data.endDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before endDate',
                path: ['endDate'],
            }
        ),
});

export const companyAttendanceRecordsQuerySchema = z.object({
    query: z
        .object({
            date: z
                .string()
                .regex(dateRegex, 'Date must be formatted as YYYY-MM-DD')
                .optional(),
            startDate: z
                .string()
                .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
                .optional(),
            endDate: z
                .string()
                .regex(dateRegex, 'endDate must be formatted as YYYY-MM-DD')
                .optional(),
            employeeId: z.string().optional(),
            status: z.nativeEnum(AttendanceStatus).optional(),
            lateOnly: z.union([z.boolean(), z.string()]).optional(),
            incompleteOnly: z.union([z.boolean(), z.string()]).optional(),
            page: z.coerce.number().min(1).optional().default(1),
            limit: z.coerce.number().min(1).max(100).optional().default(20),
            sortBy: z.string().optional().default('date'),
            sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
        })
        .refine(
            (data) => {
                if (data.startDate && data.endDate) {
                    return data.startDate <= data.endDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before endDate',
                path: ['endDate'],
            }
        ),
});

export const memberAttendanceHistoryQuerySchema = z.object({
    query: z
        .object({
            startDate: z
                .string()
                .regex(dateRegex, 'startDate must be formatted as YYYY-MM-DD')
                .optional(),
            endDate: z
                .string()
                .regex(dateRegex, 'endDate must be formatted as YYYY-MM-DD')
                .optional(),
            status: z.nativeEnum(AttendanceStatus).optional(),
            page: z.coerce.number().min(1).optional().default(1),
            limit: z.coerce.number().min(1).max(90).optional().default(20),
        })
        .refine(
            (data) => {
                if (data.startDate && data.endDate) {
                    return data.startDate <= data.endDate;
                }
                return true;
            },
            {
                message: 'startDate must be on or before endDate',
                path: ['endDate'],
            }
        ),
});
