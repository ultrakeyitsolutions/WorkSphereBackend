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

export const createMessageSchema = z.object({
    params: z.object({
        conversationId: z.string().min(1, 'conversationId is required'),
    }),
    body: z.object({
        clientMessageId: z.string().optional().nullable(),
        messageType: z.enum(['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO']).default('TEXT'),
        text: z.string().optional().nullable(),
        fileId: z.string().optional().nullable(),
        audioMetadata: z.object({
            duration: z.number().optional(),
            mimeType: z.string().optional(),
            fileSize: z.number().optional(),
            waveformData: z.array(z.number()).optional(),
        }).optional().nullable(),
    }),
});

export const messageParamSchema = z.object({
    params: z.object({
        messageId: z.string().min(1, 'messageId is required'),
    }),
});
