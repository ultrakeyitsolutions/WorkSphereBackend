import { z } from 'zod';

export const createConversationSchema = z.object({
    body: z.object({
        projectId: z.string().min(1, 'projectId is required'),
        participantId: z.string().min(1, 'participantId is required'),
    }),
});

export const conversationParamSchema = z.object({
    params: z.object({
        conversationId: z.string().min(1, 'conversationId is required'),
    }),
});

export const listMessagesSchema = z.object({
    params: z.object({
        conversationId: z.string().min(1, 'conversationId is required'),
    }),
    query: z.object({
        limit: z.string().regex(/^\d+$/).transform(Number).optional(),
        cursor: z.string().optional(),
    }).optional(),
});

export const messageParamSchema = z.object({
    params: z.object({
        messageId: z.string().min(1, 'messageId is required'),
    }),
});
