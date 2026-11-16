import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { StorageProvider } from '../storage-provider.interface';

export interface CloudinaryConfig {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    deliveryUrl?: string;
    pullZoneUrl?: string;
    basePath?: string;
}

export class CloudinaryStorageProvider implements StorageProvider {
    private readonly config: CloudinaryConfig;
    private readonly client: typeof cloudinary;

    constructor(config: CloudinaryConfig) {
        // Support parsing Cloudinary connection string if provided in any field (e.g. cloudinary://key:secret@cloudName)
        let extractedKey = '';
        let extractedSecret = '';
        let extractedCloud = '';

        const candidateStrings = [config.cloudName, config.deliveryUrl, config.pullZoneUrl].filter(Boolean);
        for (const str of candidateStrings) {
            const m = String(str).trim().match(/^cloudinary:\/\/(?:([^:]+):([^@]+)@)?([^/]+)/);
            if (m) {
                if (m[1]) extractedKey = m[1];
                if (m[2]) extractedSecret = m[2];
                if (m[3]) extractedCloud = m[3];
                break;
            }
        }

        const rawCloud = String(config.cloudName || extractedCloud || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanCloudName = rawCloud.startsWith('cloudinary://')
            ? (extractedCloud || rawCloud.replace(/^cloudinary:\/\/(?:[^@]+@)?/, '').split('/')[0])
            : rawCloud;

        const cleanApiKey = String(config.apiKey || extractedKey || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanApiSecret = String(config.apiSecret || extractedSecret || '').trim().replace(/^['"]|['"]$/g, '');

        if (!cleanCloudName || !cleanApiKey || !cleanApiSecret) {
            throw new Error('Invalid Cloudinary configuration: cloudName, apiKey, and apiSecret are required.');
        }

        // Delivery URL must strictly be an HTTP or HTTPS prefix. Never store or use cloudinary:// as a delivery URL.
        const rawDelivery = (config.deliveryUrl || config.pullZoneUrl || '').trim().replace(/\/+$/, '');
        let cleanDeliveryUrl: string | undefined = undefined;
        if (rawDelivery && !rawDelivery.startsWith('cloudinary://')) {
            try {
                const parsed = new URL(rawDelivery);
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                    cleanDeliveryUrl = rawDelivery;
                }
            } catch {
                cleanDeliveryUrl = undefined;
            }
        }

        this.config = {
            ...config,
            cloudName: cleanCloudName,
            apiKey: cleanApiKey,
            apiSecret: cleanApiSecret,
            deliveryUrl: cleanDeliveryUrl,
            basePath: (config.basePath || 'worksphere').replace(/^\/+|\/+$/g, ''),
        };

        // Configure Cloudinary instance
        this.client = cloudinary;
        this.client.config({
            cloud_name: this.config.cloudName,
            api_key: this.config.apiKey,
            api_secret: this.config.apiSecret,
            secure: true,
        });
    }

    /**
     * Resolves all candidate public IDs for Cloudinary lookups (with and without extension, with and without prefix).
     */
    private getCandidatePublicIds(storageKey: string): string[] {
        const cleanKey = storageKey.replace(/^\/+/, '');
        const candidates = new Set<string>();
        candidates.add(cleanKey);

        const lastDot = cleanKey.lastIndexOf('.');
        if (lastDot !== -1 && lastDot > cleanKey.lastIndexOf('/')) {
            candidates.add(cleanKey.substring(0, lastDot));
        }

        const filename = cleanKey.split('/').pop() || cleanKey;
        candidates.add(filename);
        const fileDot = filename.lastIndexOf('.');
        if (fileDot !== -1) {
            candidates.add(filename.substring(0, fileDot));
        }

        return Array.from(candidates);
    }

    /**
     * Upload a binary buffer to Cloudinary.
     */
    async uploadFile(
        buffer: Buffer,
        storageKey: string,
        mimeType?: string
    ): Promise<{
        storageKey: string;
        storageUrl: string;
        size: number;
        thumbnailUrl?: string;
    }> {
        const cleanKey = storageKey.replace(/^\/+/, '');

        // Choose appropriate resource type
        let resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto';
        if (mimeType?.startsWith('image/')) resourceType = 'image';
        else if (mimeType?.startsWith('video/')) resourceType = 'video';
        else if (mimeType?.startsWith('audio/')) resourceType = 'video';
        else if (mimeType?.startsWith('text/') || mimeType?.includes('document') || mimeType?.includes('pdf') || mimeType?.includes('csv') || mimeType?.includes('sheet')) resourceType = 'raw';

        // For image and video assets, Cloudinary automatically appends the format extension when generating delivery URLs.
        // Stripping the trailing file extension from public_id prevents double extensions (.mp4.mp4, .webm.webm, .png.png).
        // Raw files retain their extension in public_id as required by Cloudinary raw assets.
        let uploadPublicId = cleanKey;
        if (resourceType === 'image' || resourceType === 'video') {
            uploadPublicId = cleanKey.replace(/\.[a-zA-Z0-9]+$/, '');
        }

        return new Promise((resolve, reject) => {
            const uploadStream = this.client.uploader.upload_stream(
                {
                    public_id: uploadPublicId,
                    resource_type: resourceType,
                    overwrite: true,
                    use_filename: false,
                    unique_filename: false,
                },
                (error, result) => {
                    if (error || !result) {
                        return reject(
                            new Error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`)
                        );
                    }

                    let storageUrl = result.secure_url || result.url;
                    // If custom Pull Zone / delivery URL configured and is valid https, rewrite host
                    if (this.config.deliveryUrl && /^https?:\/\//i.test(this.config.deliveryUrl)) {
                        const standardCloudinaryPrefix = `https://res.cloudinary.com/${this.config.cloudName}`;
                        if (storageUrl.startsWith(standardCloudinaryPrefix)) {
                            storageUrl = storageUrl.replace(standardCloudinaryPrefix, this.config.deliveryUrl);
                        }
                    }

                    // Generate thumbnail URL for video assets
                    let thumbnailUrl: string | undefined = undefined;
                    if (resourceType === 'video') {
                        thumbnailUrl = this.client.url(result.public_id, {
                            resource_type: 'video',
                            format: 'jpg',
                            secure: true,
                        });
                    }

                    const formatExt = result.format ? `.${result.format}` : '';
                    const returnStorageKey = cleanKey.endsWith(formatExt)
                        ? cleanKey
                        : `${result.public_id}${formatExt}`;

                    resolve({
                        storageKey: returnStorageKey,
                        storageUrl,
                        size: result.bytes || buffer.length,
                        thumbnailUrl,
                    });
                }
            );

            uploadStream.end(buffer);
        });
    }

    /**
     * Resolves resource type ('image' | 'video' | 'raw') based on filename extension and optional MIME type.
     */
    static resolveResourceType(key: string, mimeType?: string): 'image' | 'video' | 'raw' {
        if (mimeType) {
            if (mimeType.startsWith('image/')) return 'image';
            if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video';
            if (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('document')) return 'raw';
        }
        const lower = key.toLowerCase();
        if (/\.(mp4|mov|webm|mkv|avi|m4a|mp3|wav|ogg|aac|flac|mka)$/.test(lower)) return 'video';
        if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|json|zip|tar|gz)$/.test(lower)) return 'raw';
        return 'image';
    }

    /**
     * Safely converts any Cloudinary reference (including cloudinary:// credentials URIs,
     * public IDs, or HTTPS delivery URLs) into a clean, public HTTPS delivery URL.
     * Never leaks credentials or blindly substitutes protocols.
     */
    static toHttpsDeliveryUrl(urlOrKey: string, fallbackCloudName?: string, customDeliveryUrl?: string): string {
        if (!urlOrKey || !urlOrKey.trim()) return '';
        const trimmed = urlOrKey.trim();

        // 1. If it starts with cloudinary://
        if (trimmed.startsWith('cloudinary://')) {
            const m = trimmed.match(/^cloudinary:\/\/(?:([^:]+):([^@]+)@)?([^/]+)(?:\/(.*))?$/);
            if (m) {
                const cloudName = m[3] || fallbackCloudName || '';
                const path = m[4] ? m[4].replace(/^\/+/, '') : '';

                if (!path) {
                    return cloudName ? `https://res.cloudinary.com/${cloudName}` : '';
                }

                // If path already contains resource_type/upload/... (e.g. image/upload/v1234/file.jpg)
                if (/^(?:image|video|raw)\/upload\//.test(path)) {
                    return `https://res.cloudinary.com/${cloudName}/${path}`;
                }

                // If path has /upload/ without resource type
                if (/^upload\//.test(path)) {
                    const resourceType = CloudinaryStorageProvider.resolveResourceType(path);
                    return `https://res.cloudinary.com/${cloudName}/${resourceType}/${path}`;
                }

                // Standard public ID path
                const resourceType = CloudinaryStorageProvider.resolveResourceType(path);
                return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${path}`;
            }
        }

        // 2. If it's already an HTTP / HTTPS URL
        if (/^https?:\/\//i.test(trimmed)) {
            try {
                const parsed = new URL(trimmed);
                // Check if this is a Cloudinary URL that is missing resource_type/upload segments
                // e.g. https://res.cloudinary.com/kjl8mluw/worksphere/companies/.../file.pdf
                if (parsed.hostname === 'res.cloudinary.com' || parsed.hostname.endsWith('.cloudinary.com')) {
                    const segments = parsed.pathname.replace(/^\/+/, '').split('/');
                    if (segments.length >= 2) {
                        const cloudName = segments[0];
                        const secondSegment = segments[1];
                        // If the segment immediately following cloudName is NOT a valid Cloudinary resource_type
                        if (!['image', 'video', 'raw'].includes(secondSegment)) {
                            const remainingPath = segments.slice(1).join('/');
                            const resourceType = CloudinaryStorageProvider.resolveResourceType(remainingPath);
                            return `https://${parsed.hostname}/${cloudName}/${resourceType}/upload/${remainingPath}${parsed.search}`;
                        }
                    }
                }
                return parsed.toString();
            } catch {
                return trimmed;
            }
        }

        // 3. Storage key / public ID
        const cleanKey = trimmed.replace(/^\/+/, '');
        const resourceType = CloudinaryStorageProvider.resolveResourceType(cleanKey);

        if (customDeliveryUrl && /^https?:\/\//i.test(customDeliveryUrl)) {
            const base = customDeliveryUrl.replace(/\/+$/, '');
            // If custom delivery URL points to res.cloudinary.com (e.g. https://res.cloudinary.com/<cloudName>)
            // without /upload/, ensure /<resourceType>/upload/ is included
            if (base.includes('res.cloudinary.com') && !base.includes('/upload')) {
                return `${base}/${resourceType}/upload/${cleanKey}`;
            }
            return `${base}/${cleanKey}`;
        }

        const cloud = fallbackCloudName || 'worksphere';
        return `https://res.cloudinary.com/${cloud}/${resourceType}/upload/${cleanKey}`;
    }

    /**
     * Generate an authorized expiring signed Cloudinary delivery URL with signature.
     * For raw assets (e.g. PDFs, CSVs, documents), Cloudinary restricts public delivery.
     * We use private_download_url with the API key/secret to grant authorized access.
     * For image/video assets, canonical delivery URLs are returned to avoid signature mismatches.
     */
    getSignedUrl(storageKey: string, expiresInSeconds = 3600): string {
        const cleanKey = storageKey.replace(/^\/+/, '');
        const resourceType = CloudinaryStorageProvider.resolveResourceType(cleanKey);

        if (resourceType === 'raw') {
            try {
                return this.client.utils.private_download_url(cleanKey, '', {
                    resource_type: 'raw',
                    type: 'upload',
                    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
                });
            } catch {
                return this.getFileUrl(storageKey);
            }
        }

        return this.getFileUrl(storageKey);
    }

    /**
     * Get a thumbnail preview URL for a video asset (converts frame to JPG).
     */
    getThumbnailUrl(storageKey: string): string {
        const cleanKey = storageKey.replace(/^\/+/, '');
        const resourceType = CloudinaryStorageProvider.resolveResourceType(cleanKey);
        if (resourceType === 'video') {
            return this.client.url(cleanKey, {
                resource_type: 'video',
                format: 'jpg',
                secure: true,
            });
        }
        return this.getFileUrl(cleanKey);
    }

    /**
     * Delete a file from Cloudinary by public ID / storage key.
     */
    async deleteFile(storageKey: string): Promise<boolean> {
        const candidates = this.getCandidatePublicIds(storageKey);
        const resourceTypes: Array<'raw' | 'image' | 'video'> = ['raw', 'image', 'video'];

        for (const candidate of candidates) {
            for (const resource_type of resourceTypes) {
                try {
                    const res = await this.client.uploader.destroy(candidate, {
                        resource_type,
                        invalidate: true,
                    });
                    if (res?.result === 'ok') {
                        return true;
                    }
                } catch {
                    // Try next candidate or resource type
                }
            }
        }
        return false;
    }

    /**
     * Check if a resource exists in Cloudinary.
     */
    async fileExists(storageKey: string): Promise<boolean> {
        const candidates = this.getCandidatePublicIds(storageKey);
        const resourceTypes: Array<'raw' | 'image' | 'video'> = ['raw', 'image', 'video'];

        for (const candidate of candidates) {
            for (const resource_type of resourceTypes) {
                try {
                    const res = await this.client.api.resource(candidate, { resource_type });
                    if (res && res.public_id) {
                        return true;
                    }
                } catch (err: any) {
                    if (err?.error?.http_code === 404 || err?.http_code === 404) {
                        continue;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Get the public delivery URL for a given storage key.
     */
    getFileUrl(storageKey: string): string {
        return CloudinaryStorageProvider.toHttpsDeliveryUrl(
            storageKey,
            this.config.cloudName,
            this.config.deliveryUrl
        );
    }

    /**
     * Stream a file from Cloudinary HTTPS delivery URL with byte range support.
     * Uses resilient candidate URL resolution (private_download_url for restricted raw files,
     * canonical delivery URLs and double-extension fallbacks for videos/audio).
     */
    async getFileStream(
        storageKey: string,
        range?: string
    ): Promise<{
        stream: NodeJS.ReadableStream;
        statusCode: number;
        headers: Record<string, string | number | undefined>;
    }> {
        const cleanKey = storageKey.replace(/^\/+/, '');
        const resourceType = CloudinaryStorageProvider.resolveResourceType(cleanKey);
        const ext = cleanKey.split('.').pop()?.toLowerCase();

        const candidateUrls: string[] = [];
        if (resourceType === 'raw') {
            // Raw files (PDFs, CSVs, DOCX): Use private_download_url first (bypasses ACL restrictions), then canonical URL
            try {
                candidateUrls.push(
                    this.client.utils.private_download_url(cleanKey, '', { resource_type: 'raw', type: 'upload' })
                );
            } catch {}
            candidateUrls.push(this.getFileUrl(cleanKey));
        } else {
            // Video and image files: Try canonical delivery URL, then format-appended URL (for legacy double-extension assets)
            candidateUrls.push(this.getFileUrl(cleanKey));
            if (ext) {
                candidateUrls.push(this.getFileUrl(`${cleanKey}.${ext}`));
            }
            try {
                candidateUrls.push(
                    this.client.utils.private_download_url(cleanKey, '', { resource_type: resourceType, type: 'upload' })
                );
            } catch {}
        }

        const reqHeaders: Record<string, string> = {};
        if (range) {
            reqHeaders['Range'] = range;
        }

        let lastResponse: Response | null = null;
        for (const candidateUrl of candidateUrls) {
            try {
                const response = await fetch(candidateUrl, {
                    method: 'GET',
                    headers: reqHeaders,
                });

                if (response.ok || response.status === 206) {
                    const stream = response.body
                        ? (Readable.fromWeb(response.body as any) as NodeJS.ReadableStream)
                        : Readable.from(Buffer.alloc(0));

                    return {
                        stream,
                        statusCode: response.status,
                        headers: {
                            'content-type': response.headers.get('content-type') || (resourceType === 'video' ? 'video/mp4' : 'application/octet-stream'),
                            'content-length': response.headers.get('content-length') || undefined,
                            'content-range': response.headers.get('content-range') || undefined,
                            'accept-ranges': response.headers.get('accept-ranges') || 'bytes',
                            'etag': response.headers.get('etag') || undefined,
                            'last-modified': response.headers.get('last-modified') || undefined,
                        },
                    };
                }
                lastResponse = response;
            } catch {
                // Continue to next candidate URL
            }
        }

        throw new Error(
            `Cloudinary media fetch failed with status ${lastResponse?.status || 404}: ${lastResponse?.statusText || 'Asset not found on Cloudinary'}`
        );
    }

    /**
     * Ping Cloudinary API to verify credentials.
     */
    async ping(): Promise<boolean> {
        const result = await this.client.api.ping();
        return result?.status === 'ok';
    }
}
