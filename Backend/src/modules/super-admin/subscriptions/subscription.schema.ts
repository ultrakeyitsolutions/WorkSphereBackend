import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: 'Invalid ObjectId format',
});

// Create subscription
export const createSubscriptionSchema = z.object({
    body: z.object({
        planId: objectIdSchema,
        periodStart: z.string().datetime().optional(), // ISO string
    }),
});

// Upgrade / Downgrade subscription
export const changePlanSchema = z.object({
    body: z.object({
        planId: objectIdSchema,
        effectiveImmediate: z.boolean().default(true),
    }),
});

// Pause subscription
export const pauseSubscriptionSchema = z.object({
    body: z.object({
        pauseFrom: z.string().datetime().optional(),
        resumeAt: z.string().datetime().optional(),
        reason: z.string().optional(),
    }),
});

// Resume subscription
export const resumeSubscriptionSchema = z.object({
    body: z.object({
        resumeImmediate: z.boolean().default(true),
    }),
});

// Cancel subscription
export const cancelSubscriptionSchema = z.object({
    body: z.object({
        cancelImmediate: z.boolean().default(false),
        reason: z.string().optional(),
    }),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>['body'];
export type ChangePlanInput = z.infer<typeof changePlanSchema>['body'];
export type PauseSubscriptionInput = z.infer<typeof pauseSubscriptionSchema>['body'];
export type ResumeSubscriptionInput = z.infer<typeof resumeSubscriptionSchema>['body'];
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>['body'];
