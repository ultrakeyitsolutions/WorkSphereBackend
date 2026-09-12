import { StorageProvider } from '../storage-provider.interface';

export interface BunnyConfig {
    storageZone: string;
    accessKey: string;
    region?: string;
    pullZoneUrl: string;
    basePath?: string;
}

export class BunnyStorageProvider implements StorageProvider {
    private readonly config: BunnyConfig;

    constructor(config: BunnyConfig) {
        if (!config.storageZone || !config.accessKey) {
            throw new Error('Invalid Bunny.net configuration: storageZone and accessKey are required.');
        }
        this.config = {
            ...config,
            storageZone: (config.storageZone || '').trim(),
            accessKey: (config.accessKey || '').trim(),
            region: (config.region || '').toLowerCase().trim(),
            pullZoneUrl: (config.pullZoneUrl || '').trim(),
            basePath: (config.basePath || 'worksphere').replace(/^\/+|\/+$/g, ''),
        };
    }

    /**
     * Resolve Bunny storage host based on region.
     */
    private getStorageHost(): string {
        let region = (this.config.region || '').toLowerCase().trim();
        if (region.startsWith('http://') || region.startsWith('https://')) {
            try {
                region = new URL(region).hostname;
            } catch {
                // ignore
            }
        }
        if (region.endsWith('.storage.bunnycdn.com')) {
            return `https://${region}`;
        }
        if (region === 'storage.bunnycdn.com') {
            return 'https://storage.bunnycdn.com';
        }
        if (region && region !== 'de' && region !== 'default') {
            return `https://${region}.storage.bunnycdn.com`;
        }
        return 'https://storage.bunnycdn.com';
    }

    /**
     * Sanitize storage key to avoid traversal or invalid characters.
     */
    private sanitizeKey(storageKey: string): string {
        return storageKey
            .replace(/\\/g, '/')
            .replace(/\.{2,}/g, '') // remove ..
            .replace(/^\/+/, '');   // remove leading slash
    }

    /**
     * Upload a file buffer to Bunny Storage.
     */
    async uploadFile(
        buffer: Buffer,
        storageKey: string,
        mimeType = 'application/octet-stream'
    ): Promise<{ storageKey: string; storageUrl: string; size: number }> {
        const cleanKey = this.sanitizeKey(storageKey);
        const url = `${this.getStorageHost()}/${this.config.storageZone}/${cleanKey}`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                AccessKey: this.config.accessKey,
                'Content-Type': mimeType,
                'Content-Length': buffer.length.toString(),
            },
            body: new Uint8Array(buffer),
        });

        if (!response.ok && response.status !== 201 && response.status !== 200) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(
                `Bunny Storage upload failed (status ${response.status}): ${errorText}`
            );
        }

        return {
            storageKey: cleanKey,
            storageUrl: this.getFileUrl(cleanKey),
            size: buffer.length,
        };
    }

    /**
     * Delete a file from Bunny Storage.
     */
    async deleteFile(storageKey: string): Promise<boolean> {
        const cleanKey = this.sanitizeKey(storageKey);
        const url = `${this.getStorageHost()}/${this.config.storageZone}/${cleanKey}`;

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                AccessKey: this.config.accessKey,
            },
        });

        if (response.status === 200 || response.status === 404) {
            return true;
        }

        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(
            `Bunny Storage delete failed (status ${response.status}): ${errorText}`
        );
    }

    /**
     * Check if a file exists in Bunny Storage.
     */
    async fileExists(storageKey: string): Promise<boolean> {
        const cleanKey = this.sanitizeKey(storageKey);
        const url = `${this.getStorageHost()}/${this.config.storageZone}/${cleanKey}`;

        try {
            const response = await fetch(url, {
                method: 'HEAD',
                headers: {
                    AccessKey: this.config.accessKey,
                },
            });

            if (response.status === 200) {
                return true;
            }
            if (response.status === 404) {
                return false;
            }

            // Some storage endpoints respond better to GET for directory/file verification
            const getResponse = await fetch(url, {
                method: 'GET',
                headers: {
                    AccessKey: this.config.accessKey,
                    Range: 'bytes=0-0', // minimize payload
                },
            });

            return getResponse.status === 200 || getResponse.status === 206;
        } catch {
            return false;
        }
    }

    /**
     * Generate the public CDN delivery URL for a storage key.
     */
    getFileUrl(storageKey: string): string {
        const cleanKey = this.sanitizeKey(storageKey);
        const pullZone = this.config.pullZoneUrl
            ? this.config.pullZoneUrl.replace(/\/+$/, '')
            : `${this.getStorageHost()}/${this.config.storageZone}`;

        const fullUrl = `${pullZone}/${cleanKey}`;
        return fullUrl.startsWith('http://') || fullUrl.startsWith('https://')
            ? fullUrl
            : `https://${fullUrl}`;
    }
}
