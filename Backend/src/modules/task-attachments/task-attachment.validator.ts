import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

export const createAttachmentSchema = z.object({
    params: z.object({
        taskId: idSchema
    }),
    body: z.object({
        fileName: z.string().min(1),
        originalName: z.string().optional(),
        filePath: z.string().optional(),
        url: z.string().optional(),
        storageKey: z.string().optional(),
        fileType: z.string().optional(),
        type: z.string().optional(),
        fileSize: z.number().optional(),
        size: z.number().optional(),
        contentType: z.string().optional(),
        mimeType: z.string().optional(),
        youtubeVideoId: z.string().nullable().optional()
    })
});

export const attachmentParamSchema = z.object({
    params: z.object({
        attachmentId: idSchema
    })
});
