import { z } from 'zod';

export const startCallSchema = z.object({
    body: z.object({
        conversationId: z.string().min(1, 'conversationId is required'),
        type: z.enum(['AUDIO', 'VIDEO']),
    }),
});

export const callIdParamSchema = z.object({
    params: z.object({
        callId: z.string().min(1, 'callId is required'),
    }),
});
