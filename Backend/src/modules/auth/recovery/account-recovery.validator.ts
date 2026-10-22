import { z } from 'zod';

export const createRecoveryRequestSchema = z.object({
    body: z.object({
        email: z
            .string()
            .min(1, 'Email address is required')
            .trim()
            .toLowerCase()
            .email('Invalid email address format'),
    }),
});

export const completeRecoverySchema = z.object({
    params: z.object({
        requestId: z.string().trim().min(1, 'Request ID is required'),
    }),
    body: z.object({
        token: z
            .string()
            .trim()
            .min(16, 'Invalid verification token format'),
    }),
});

export const getRecoveryStatusSchema = z.object({
    params: z.object({
        requestId: z.string().trim().min(1, 'Request ID is required'),
    }),
});

export const approveRecoverySchema = z.object({
    params: z.object({
        requestId: z.string().trim().min(1, 'Request ID is required'),
    }),
    body: z.object({
        adminReason: z.string().trim().max(1000).optional(),
    }),
});

export const rejectRecoverySchema = z.object({
    params: z.object({
        requestId: z.string().trim().min(1, 'Request ID is required'),
    }),
    body: z.object({
        adminReason: z
            .string()
            .trim()
            .min(2, 'Please provide a clear administrative rejection reason')
            .max(1000),
    }),
});

export const listRecoveryRequestsQuerySchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED']).optional(),
        search: z.string().trim().optional(),
    }),
});
