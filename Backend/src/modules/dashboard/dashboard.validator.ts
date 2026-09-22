import { z } from 'zod';
import { Types } from 'mongoose';

const isValidObjectId = (val?: string) => !val || Types.ObjectId.isValid(val);

export const dashboardQuerySchema = z.object({
    query: z.object({
        period: z.enum(['today', 'week', 'this_week', 'month', 'this_month', 'last_month', 'custom'])
            .optional()
            .default('today')
            .transform((val) => {
                if (val === 'this_week') return 'week';
                if (val === 'this_month') return 'month';
                return val;
            }),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format').optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be in YYYY-MM-DD format').optional(),
        projectId: z.string().refine(isValidObjectId, 'Invalid projectId').optional(),
        teamId: z.string().refine(isValidObjectId, 'Invalid teamId').optional(),
        timezone: z.string().optional(),
        companyId: z.string().refine(isValidObjectId, 'Invalid companyId').optional(),
    }).refine((data) => {
        if (data.period === 'custom') {
            if (!data.startDate || !data.endDate) {
                return false;
            }
            return new Date(data.startDate) <= new Date(data.endDate);
        }
        return true;
    }, {
        message: 'startDate and endDate are required and startDate must be <= endDate when period is custom',
        path: ['startDate'],
    }),
});
