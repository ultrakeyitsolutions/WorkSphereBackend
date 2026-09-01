import { z } from 'zod';

export const createFeatureSchema = z.object({
    key: z
        .string()
        .trim()
        .min(2, 'Key must be at least 2 characters')
        .transform((val) => val.toUpperCase()),

    name: z.string().trim().min(2, 'Feature name must be at least 2 characters'),

    description: z.string().trim().min(5, 'Description must be at least 5 characters'),

    category: z.string().trim().min(2, 'Category is required').toLowerCase(),

    type: z.enum(['BOOLEAN', 'LIMIT'], {
        message: 'type must be BOOLEAN or LIMIT',
    }),

    unit: z.enum(['COUNT', 'GB', 'MB', 'PER_PROJECT', 'DAYS', 'NONE']).default('NONE'),

    isActive: z.boolean().default(true),
}).refine(
    (data) => {
        // BOOLEAN features must use unit NONE
        if (data.type === 'BOOLEAN' && data.unit !== 'NONE') return false;
        // LIMIT features must not use unit NONE
        if (data.type === 'LIMIT' && data.unit === 'NONE') return false;
        return true;
    },
    { message: 'BOOLEAN features must use unit NONE; LIMIT features must specify a unit (COUNT, GB, MB, etc.)' }
);

export const updateFeatureSchema = z.object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().min(5).optional(),
    category: z.string().trim().min(2).toLowerCase().optional(),
    type: z.enum(['BOOLEAN', 'LIMIT']).optional(),
    unit: z.enum(['COUNT', 'GB', 'MB', 'PER_PROJECT', 'DAYS', 'NONE']).optional(),
    isActive: z.boolean().optional(),
});

export type CreateFeatureInput = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;
