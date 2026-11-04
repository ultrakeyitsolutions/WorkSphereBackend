import { z } from 'zod';

export const updateStorageConfigSchema = z.object({
    body: z.object({
        provider: z.enum(['BUNNY', 'CLOUDINARY', 'CLOUDFLARE_R2', 'S3', 'OTHER']).optional(),
        enabled: z.boolean().optional(),
        configuration: z.object({
            // Bunny fields
            storageZone: z.string().trim().optional(),
            accessKey: z.string().trim().optional(),
            region: z.string().trim().optional(),
            pullZoneUrl: z.string().trim().optional(),
            basePath: z.string().trim().regex(/^[^./\\][^/\\]*$/, 'Invalid basePath: path traversal is not allowed').optional(),
            tokenSecurityKey: z.string().trim().optional(),
            tokenExpirySeconds: z.number().int().min(60).max(86400 * 30).optional(),

            // Cloudinary fields
            cloudName: z.string().trim().optional(),
            apiKey: z.string().trim().optional(),
            apiSecret: z.string().trim().optional(),
            deliveryUrl: z.string().trim().optional(),

            // Cloudflare R2 fields
            accountId: z.string().trim().optional(),
            bucketName: z.string().trim().optional(),
            accessKeyId: z.string().trim().optional(),
            secretAccessKey: z.string().trim().optional(),
            publicDeliveryUrl: z.string().trim().optional(),
            endpoint: z.string().trim().optional(),
        }).passthrough().optional(),
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
        provider: z.enum(['BUNNY', 'CLOUDINARY', 'CLOUDFLARE_R2', 'S3', 'OTHER']).default('BUNNY'),
        configuration: z.object({
            // Bunny fields
            storageZone: z.string().trim().optional(),
            accessKey: z.string().trim().optional(),
            region: z.string().trim().optional(),
            pullZoneUrl: z.string().trim().optional(),
            basePath: z.string().trim().optional(),
            tokenSecurityKey: z.string().trim().optional(),
            tokenExpirySeconds: z.number().int().min(60).max(86400 * 30).optional(),

            // Cloudinary fields
            cloudName: z.string().trim().optional(),
            apiKey: z.string().trim().optional(),
            apiSecret: z.string().trim().optional(),
            deliveryUrl: z.string().trim().optional(),

            // Cloudflare R2 fields
            accountId: z.string().trim().optional(),
            bucketName: z.string().trim().optional(),
            accessKeyId: z.string().trim().optional(),
            secretAccessKey: z.string().trim().optional(),
            publicDeliveryUrl: z.string().trim().optional(),
            endpoint: z.string().trim().optional(),
        }).passthrough(),
    }),
});

export const rollbackStorageConfigSchema = z.object({
    params: z.object({
        historyId: z.string().min(1, 'historyId parameter is required'),
    }),
});
