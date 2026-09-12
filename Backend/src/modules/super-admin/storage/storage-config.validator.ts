import { z } from 'zod';

export const updateStorageConfigSchema = z.object({
    body: z.object({
        provider: z.enum(['BUNNY', 'S3', 'CLOUDFLARE_R2', 'CLOUDINARY', 'OTHER']).optional(),
        enabled: z.boolean().optional(),
        configuration: z.object({
            storageZone: z.string().trim().min(1, 'storageZone cannot be empty').optional(),
            accessKey: z.string().trim().optional(),
            region: z.string().trim().optional(),
            pullZoneUrl: z.string().trim().min(1, 'pullZoneUrl cannot be empty').optional(),
            basePath: z.string().trim().regex(/^[^./\\][^/\\]*$/, 'Invalid basePath: path traversal is not allowed').optional(),
        }).optional(),
        limits: z.object({
            imageMaxSizeMB: z.number().positive().max(100).optional(),
            documentMaxSizeMB: z.number().positive().max(200).optional(),
            audioMaxSizeMB: z.number().positive().max(100).optional(),
            videoMaxSizeMB: z.number().positive().max(1000).optional(),
        }).optional(),
        allowedTypes: z.object({
            image: z.array(z.string().toLowerCase().trim()).optional(),
            document: z.array(z.string().toLowerCase().trim()).optional(),
            audio: z.array(z.string().toLowerCase().trim()).optional(),
            video: z.array(z.string().toLowerCase().trim()).optional(),
        }).optional(),
    }),
});

export const testStorageConfigSchema = z.object({
    body: z.object({
        provider: z.enum(['BUNNY', 'S3', 'CLOUDFLARE_R2', 'CLOUDINARY', 'OTHER']).default('BUNNY'),
        configuration: z.object({
            storageZone: z.string().trim().min(1, 'storageZone is required'),
            accessKey: z.string().trim().optional(), // If omitted, uses active stored accessKey
            region: z.string().trim().optional(),
            pullZoneUrl: z.string().trim().min(1, 'pullZoneUrl is required'),
            basePath: z.string().trim().optional(),
        }),
    }),
});

export const rollbackStorageConfigSchema = z.object({
    params: z.object({
        historyId: z.string().min(1, 'historyId parameter is required'),
    }),
});
