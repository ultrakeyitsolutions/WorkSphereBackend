import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

// ─── Create Activity ─────────────────────────────────────────────────────────────
export const createActivitySchema = z.object({
    params: z.object({
        taskId: idSchema
    }),
    body: z.object({
        type: z.enum(['COMMENT', 'DOUBT', 'SYSTEM']).default('COMMENT'),
        content: z.string().optional(),
        parentId: idSchema.optional(),
        routedToRole: z.string().optional(),
        routedToUserId: idSchema.optional(),
        audio: z.object({
            url: z.string(),
            storageKey: z.string(),
            duration: z.number(),
            mimeType: z.string(),
            size: z.number()
        }).optional(),
        video: z.object({
            url: z.string(),
            storageKey: z.string(),
            duration: z.number(),
            mimeType: z.string(),
            size: z.number()
        }).optional(),
        attachments: z.array(z.object({
            fileId: z.string().optional(),
            url: z.string().optional(),
            filePath: z.string().optional(),
            fileName: z.string().optional(),
            originalName: z.string().optional(),
            mimeType: z.string().optional(),
            size: z.number().optional(),
            fileType: z.string().optional(),
        })).optional()
    }).refine(data => data.content || data.audio || data.video || (data as any).attachments?.length, { message: 'Must provide content, audio, video, or attachments' })
});

// ─── Create Reply ─────────────────────────────────────────────────────────────
export const createReplySchema = z.object({
    params: z.object({
        activityId: idSchema
    }),
    body: z.object({
        content: z.string().optional(),
        audio: z.object({
            url: z.string(),
            storageKey: z.string(),
            duration: z.number(),
            mimeType: z.string(),
            size: z.number()
        }).optional(),
        video: z.object({
            url: z.string(),
            storageKey: z.string(),
            duration: z.number(),
            mimeType: z.string(),
            size: z.number()
        }).optional(),
        attachments: z.array(z.object({
            fileId: z.string().optional(),
            url: z.string().optional(),
            filePath: z.string().optional(),
            fileName: z.string().optional(),
            originalName: z.string().optional(),
            mimeType: z.string().optional(),
            size: z.number().optional(),
            fileType: z.string().optional(),
        })).optional()
    }).refine(data => data.content || data.audio || data.video || (data as any).attachments?.length, { message: 'Must provide content, audio, video, or attachments' })
});
