import { z } from 'zod';
import { Types } from 'mongoose';

const isValidObjectId = (val: string) => Types.ObjectId.isValid(val);

export const performanceQuerySchema = z.object({
    params: z.object({
        userId: z.string().refine(isValidObjectId, { message: 'Invalid target userId format' }),
    }),
    query: z.object({
        range: z
            .enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'])
            .optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        timezone: z.string().optional(),
        page: z.string().transform((v) => parseInt(v, 10)).optional(),
        limit: z
            .string()
            .transform((v) => Math.min(100, Math.max(1, parseInt(v, 10))))
            .optional(),
    }),
});
