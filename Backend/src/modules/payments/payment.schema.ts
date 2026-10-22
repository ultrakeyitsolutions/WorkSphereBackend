import { z } from 'zod';

export const createPaymentAttemptSchema = z.object({
    body: z.object({
        planId: z.string().min(1, 'planId is required'),
        billingCycle: z.enum(['MONTHLY', 'SEMI_ANNUAL', 'YEARLY']).optional(),
        billingObligationId: z.string().optional(),
        isAutoPay: z.boolean().optional(),
        idempotencyKey: z.string().min(1).optional(),
        companyId: z.string().optional(), // Allowed for SuperAdmin override
        metadata: z.record(z.string(), z.any()).optional(),
    }),
});

export const verifyPaymentSchema = z.object({
    body: z.object({
        providerPaymentId: z.string().min(1, 'providerPaymentId is required'),
        providerOrderId: z.string().min(1, 'providerOrderId is required'),
        providerSignature: z.string().min(1, 'providerSignature is required'),
    }),
});
