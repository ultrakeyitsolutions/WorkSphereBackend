import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageProvider } from '../storage-provider.interface';

export interface CloudflareR2Config {
    accountId: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicDeliveryUrl?: string;
    pullZoneUrl?: string;
    endpoint?: string;
    basePath?: string;
}

export class CloudflareR2StorageProvider implements StorageProvider {
    private readonly config: CloudflareR2Config;
    private readonly client: S3Client;

    constructor(config: CloudflareR2Config) {
        if (!config.accountId || !config.bucketName || !config.accessKeyId || !config.secretAccessKey) {
            throw new Error(
                'Invalid Cloudflare R2 configuration: accountId, bucketName, accessKeyId, and secretAccessKey are required.'
            );
        }

        const cleanAccountId = String(config.accountId || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanBucket = String(config.bucketName || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanAccessKey = String(config.accessKeyId || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanSecretKey = String(config.secretAccessKey || '').trim().replace(/^['"]|['"]$/g, '');
        const cleanDeliveryUrl = (config.publicDeliveryUrl || config.pullZoneUrl || '').trim().replace(/\/+$/, '');

        const resolvedEndpoint = config.endpoint
            ? config.endpoint.trim().replace(/\/+$/, '')
            : `https://${cleanAccountId}.r2.cloudflarestorage.com`;

        this.config = {
            ...config,
            accountId: cleanAccountId,
            bucketName: cleanBucket,
            accessKeyId: cleanAccessKey,
            secretAccessKey: cleanSecretKey,
            publicDeliveryUrl: cleanDeliveryUrl || undefined,
            endpoint: resolvedEndpoint,
            basePath: (config.basePath || 'worksphere').replace(/^\/+|\/+$/g, ''),
        };

        this.client = new S3Client({
            region: 'auto',
            endpoint: this.config.endpoint,
            credentials: {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
            },
        });
    }

    private sanitizeStorageKey(storageKey: string): string {
        return storageKey.replace(/^\/+/, '');
    }

    /**
     * Upload binary buffer to Cloudflare R2.
     */
    async uploadFile(
        buffer: Buffer,
        storageKey: string,
        mimeType?: string
    ): Promise<{
        storageKey: string;
        storageUrl: string;
        size: number;
    }> {
        const cleanKey = this.sanitizeStorageKey(storageKey);

        const command = new PutObjectCommand({
            Bucket: this.config.bucketName,
            Key: cleanKey,
            Body: buffer,
            ContentType: mimeType || 'application/octet-stream',
        });

        await this.client.send(command);

        return {
            storageKey: cleanKey,
            storageUrl: this.getFileUrl(cleanKey),
            size: buffer.length,
        };
    }

    /**
     * Delete an object from Cloudflare R2.
     */
    async deleteFile(storageKey: string): Promise<boolean> {
        const cleanKey = this.sanitizeStorageKey(storageKey);
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.config.bucketName,
                Key: cleanKey,
            });
            await this.client.send(command);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if an object exists in Cloudflare R2.
     */
    async fileExists(storageKey: string): Promise<boolean> {
        const cleanKey = this.sanitizeStorageKey(storageKey);
        try {
            const command = new HeadObjectCommand({
                Bucket: this.config.bucketName,
                Key: cleanKey,
            });
            await this.client.send(command);
            return true;
        } catch (err: any) {
            if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw err;
        }
    }

    /**
     * Resolve public delivery URL for Cloudflare R2 storage key.
     */
    getFileUrl(storageKey: string): string {
        const cleanKey = this.sanitizeStorageKey(storageKey);
        if (this.config.publicDeliveryUrl) {
            return `${this.config.publicDeliveryUrl}/${cleanKey}`;
        }
        return `https://${this.config.bucketName}.${this.config.accountId}.r2.cloudflarestorage.com/${cleanKey}`;
    }
}
