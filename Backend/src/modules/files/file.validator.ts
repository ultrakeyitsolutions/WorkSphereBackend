import { z } from 'zod';
import { StorageLimits, StorageAllowedTypes } from '../super-admin/storage/storage-config.types';

export const DANGEROUS_EXTENSIONS = new Set([
    'exe', 'bat', 'cmd', 'sh', 'bash', 'vbs', 'js', 'mjs', 'cjs',
    'msi', 'php', 'phtml', 'scr', 'dll', 'com', 'jar', 'apk', 'app',
    'bin', 'cgi', 'gadget', 'inf', 'ins', 'inx', 'isu', 'job', 'jse',
    'lnk', 'msc', 'msp', 'mst', 'paf', 'pif', 'ps1', 'reg', 'rgs',
    'sct', 'shb', 'shs', 'u3p', 'vb', 'vbe', 'ws', 'wsf', 'wsh'
]);

export interface ValidationResult {
    valid: boolean;
    error?: string;
    category?: 'image' | 'document' | 'audio' | 'video' | 'other';
}

export const validateUploadedFile = (
    fileName: string,
    mimeType: string,
    fileSizeBytes: number,
    limits: StorageLimits,
    allowedTypes: StorageAllowedTypes
): ValidationResult => {
    // 1. Check extension
    const parts = fileName.split('.');
    if (parts.length < 2) {
        return { valid: false, error: 'File must have a valid extension.' };
    }
    const extension = parts.pop()!.toLowerCase().trim();

    // 2. Denylist check
    if (DANGEROUS_EXTENSIONS.has(extension)) {
        return {
            valid: false,
            error: `File type .${extension} is blocked for security reasons.`,
        };
    }

    // 3. Category & Allowed Types Check
    let category: 'image' | 'document' | 'audio' | 'video' | null = null;
    if (allowedTypes.image.includes(extension)) category = 'image';
    else if (allowedTypes.document.includes(extension)) category = 'document';
    else if (allowedTypes.audio.includes(extension)) category = 'audio';
    else if (allowedTypes.video.includes(extension)) category = 'video';

    if (!category) {
        return {
            valid: false,
            error: `File extension .${extension} is not permitted.`,
        };
    }

    // 4. Max size check
    let maxMB = 15;
    if (category === 'image') maxMB = limits.imageMaxSizeMB;
    else if (category === 'document') maxMB = limits.documentMaxSizeMB;
    else if (category === 'audio') maxMB = limits.audioMaxSizeMB;
    else if (category === 'video') maxMB = limits.videoMaxSizeMB;

    const maxBytes = maxMB * 1024 * 1024;
    if (fileSizeBytes > maxBytes) {
        return {
            valid: false,
            error: `File size exceeds the configured maximum limit of ${maxMB} MB for ${category} files.`,
        };
    }

    return {
        valid: true,
        category,
    };
};

export const fileIdParamSchema = z.object({
    params: z.object({
        fileId: z.string().min(1, 'fileId is required'),
    }),
});
