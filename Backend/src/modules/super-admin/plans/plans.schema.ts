import { z } from 'zod';

// ─── Per-feature entitlement in the plan request body ─────────────────────────
const planFeatureEntitlementSchema = z.object({
    featureId: z.string().min(24, 'Invalid feature ID').max(24, 'Invalid feature ID'),
    enabled: z.boolean(),
    limitType: z.enum(['NONE', 'LIMITED', 'UNLIMITED']),
    value: z.number().positive().nullable().optional(),
}).refine(
    (data) => {
        // LIMITED must have a positive value
        if (data.limitType === 'LIMITED' && (data.value == null || data.value <= 0)) return false;
        // UNLIMITED must not have a value
        if (data.limitType === 'UNLIMITED' && data.value != null) return false;
        // NONE must not have a value
        if (data.limitType === 'NONE' && data.value != null) return false;
        return true;
    },
    { message: 'LIMITED requires value > 0; UNLIMITED and NONE must not have a value.' }
);

// ─── Create Plan Schema ───────────────────────────────────────────────────────
export const createPlanSchema = z.object({
    name: z.string().trim().min(2, 'Plan name must be at least 2 characters'),

    code: z
        .string()
        .trim()
        .min(2, 'Code must be at least 2 characters')
        .transform((val) => val.toUpperCase()),

    description: z.string().trim().min(5, 'Description must be at least 5 characters'),

    billingCycle: z.enum(['MONTHLY', 'SEMI_ANNUAL', 'YEARLY'], {
        message: 'billingCycle must be MONTHLY, SEMI_ANNUAL, or YEARLY',
    }),

    price: z.number().min(0, 'Price must be 0 or more'),

    currency: z.string().trim().length(3, 'Currency must be a 3-letter ISO code').default('INR'),

    trialPeriodDays: z.number().int().min(0).default(0),

    features: z
        .array(planFeatureEntitlementSchema)
        .default([])
        .refine(
            (features) => {
                // No duplicate featureIds
                const ids = features.map((f) => f.featureId);
                return new Set(ids).size === ids.length;
            },
            { message: 'Duplicate featureId entries are not allowed in one plan.' }
        ),

    isActive: z.boolean().default(true),
    isDefault: z.boolean().default(false),
});

// ─── Update Plan Schema ───────────────────────────────────────────────────────
export const updatePlanSchema = z.object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().min(5).optional(),
    billingCycle: z.enum(['MONTHLY', 'SEMI_ANNUAL', 'YEARLY']).optional(),
    price: z.number().min(0).optional(),
    currency: z.string().trim().length(3).optional(),
    trialPeriodDays: z.number().int().min(0).optional(),
    features: z.array(planFeatureEntitlementSchema).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;