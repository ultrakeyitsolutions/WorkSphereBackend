import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

export const createAttachmentSchema = z.object({
    params: z.object({
        taskId: idSchema
    }),
    body: z.object({
        fileName: z.string().min(1),
        originalName: z.string().min(1),
        storageKey: z.string().min(1),
        url: z.string().url(),
        mimeType: z.string().min(1),
        size: z.number().min(1),
        type: z.enum(['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'OTHER']).default('OTHER')
    })
});

export const attachmentParamSchema = z.object({
    params: z.object({
        attachmentId: idSchema
    })
});
