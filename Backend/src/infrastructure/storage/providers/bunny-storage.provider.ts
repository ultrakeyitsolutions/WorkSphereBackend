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
        let cleanZone = (config.storageZone || '').trim().replace(/^['"]|['"]$/g, '');
        if (cleanZone.includes('/')) {
            cleanZone = cleanZone.replace(/\/+$/, '').split('/').pop() || cleanZone;
        }

        const cleanKey = (config.accessKey || '').trim().replace(/^['"]|['"]$/g, '');

        this.config = {
            ...config,
            storageZone: cleanZone,
            accessKey: cleanKey,
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

        const REGION_MAP: Record<string, string> = {
            'frankfurt': 'de',
            'frankfurt, de': 'de',
            'germany': 'de',
            'falkenstein': 'de',
            'de': 'de',
            'default': 'de',
            'europe': 'de',
            'eu': 'de',
            'london': 'uk',
            'united kingdom': 'uk',
            'uk': 'uk',
            'new york': 'ny',
            'ny': 'ny',
            'us-east': 'ny',
            'los angeles': 'la',
            'la': 'la',
            'us-west': 'la',
            'singapore': 'sg',
            'sg': 'sg',
            'sydney': 'syd',
            'australia': 'syd',
            'syd': 'syd',
            'stockholm': 'se',
            'sweden': 'se',
            'se': 'se',
            'sao paulo': 'br',
            'brazil': 'br',
            'br': 'br',
            'johannesburg': 'jh',
            'south africa': 'jh',
            'jh': 'jh',
        };

        const resolvedCode = REGION_MAP[region] || region;
        if (resolvedCode && resolvedCode !== 'de' && resolvedCode !== 'default') {
            return `https://${resolvedCode}.storage.bunnycdn.com`;
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
     * Get the resolved region (auto-corrected if regional fallback occurred).
     */
    getResolvedRegion(): string {
        return this.config.region || 'de';
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

        // Fallback check: If the configured/attempted endpoint returned 401, test all other Bunny regional endpoints
        if (response.status === 401) {
            const CANDIDATE_REGIONS: Array<{ code: string; host: string }> = [
                { code: 'de', host: 'https://storage.bunnycdn.com' },
                { code: 'uk', host: 'https://uk.storage.bunnycdn.com' },
                { code: 'ny', host: 'https://ny.storage.bunnycdn.com' },
                { code: 'la', host: 'https://la.storage.bunnycdn.com' },
                { code: 'sg', host: 'https://sg.storage.bunnycdn.com' },
                { code: 'se', host: 'https://se.storage.bunnycdn.com' },
                { code: 'syd', host: 'https://syd.storage.bunnycdn.com' },
                { code: 'br', host: 'https://br.storage.bunnycdn.com' },
                { code: 'jh', host: 'https://jh.storage.bunnycdn.com' },
            ];

            for (const candidate of CANDIDATE_REGIONS) {
                if (candidate.host === this.getStorageHost()) continue;

                try {
                    const fallbackUrl = `${candidate.host}/${this.config.storageZone}/${cleanKey}`;
                    const fallbackResponse = await fetch(fallbackUrl, {
                        method: 'PUT',
                        headers: {
                            AccessKey: this.config.accessKey,
                            'Content-Type': mimeType,
                            'Content-Length': buffer.length.toString(),
                        },
                        body: new Uint8Array(buffer),
                    });

                    if (fallbackResponse.ok || fallbackResponse.status === 201 || fallbackResponse.status === 200) {
                        this.config.region = candidate.code;
                        return {
                            storageKey: cleanKey,
                            storageUrl: this.getFileUrl(cleanKey),
                            size: buffer.length,
                        };
                    }
                } catch {
                    // Try next candidate
                }
            }
        }

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

        if (response.status === 401) {
            const CANDIDATE_HOSTS = [
                'https://storage.bunnycdn.com',
                'https://uk.storage.bunnycdn.com',
                'https://ny.storage.bunnycdn.com',
                'https://la.storage.bunnycdn.com',
                'https://sg.storage.bunnycdn.com',
                'https://se.storage.bunnycdn.com',
                'https://syd.storage.bunnycdn.com',
                'https://br.storage.bunnycdn.com',
                'https://jh.storage.bunnycdn.com',
            ];

            for (const host of CANDIDATE_HOSTS) {
                if (host === this.getStorageHost()) continue;
                try {
                    const fallbackUrl = `${host}/${this.config.storageZone}/${cleanKey}`;
                    const fallbackResponse = await fetch(fallbackUrl, {
                        method: 'DELETE',
                        headers: {
                            AccessKey: this.config.accessKey,
                        },
                    });
                    if (fallbackResponse.status === 200 || fallbackResponse.status === 404) {
                        return true;
                    }
                } catch {
                    // ignore
                }
            }
        }

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
