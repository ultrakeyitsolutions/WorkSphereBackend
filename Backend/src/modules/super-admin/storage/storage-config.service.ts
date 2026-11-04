import mongoose, { Types } from 'mongoose';
import { StorageConfiguration } from './storage-config.model';
import { StorageConfigurationHistory } from './storage-config-history.model';
import {
    IStorageConfigurationDocument,
    StorageProviderEnum,
} from './storage-config.types';
import { StorageProviderFactory } from '../../../infrastructure/storage/storage-provider.factory';
import { CloudinaryStorageProvider } from '../../../infrastructure/storage/providers/cloudinary-storage.provider';
import { env } from '../../../config/env';
import { getRedisClient } from '../../../config/redis';

export class StorageConfigurationService {
    // In-memory cache for ultra-fast access on file uploads
    private static cachedConfig: IStorageConfigurationDocument | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 60 * 1000; // 1 minute TTL fallback
    private static isSubscriberInitialized = false;

    /**
     * Invalidate cached storage configuration locally.
     */
    static invalidateCache(): void {
        this.cachedConfig = null;
        this.cacheTimestamp = 0;
    }

    /**
     * Initialize Redis pub/sub subscriber to invalidate cache across all backend worker instances.
     */
    static initRedisSubscriber(): void {
        if (this.isSubscriberInitialized) return;
        try {
            const redis = getRedisClient();
            if (redis) {
                const sub = redis.duplicate();
                sub.subscribe('worksphere:storage_config_invalidated', (err) => {
                    if (err) {
                        console.warn('[StorageConfig] Failed to subscribe to Redis storage invalidation channel:', err.message);
                    } else {
                        console.log('[StorageConfig] Multi-worker Redis subscriber initialized for worksphere:storage_config_invalidated');
                        this.isSubscriberInitialized = true;
                    }
                });

                sub.on('message', (channel) => {
                    if (channel === 'worksphere:storage_config_invalidated') {
                        console.log('[StorageConfig] Invalidation received from Redis — clearing local storage cache.');
                        this.invalidateCache();
                    }
                });
            }
        } catch (err: any) {
            console.warn('[StorageConfig] Redis subscriber init warning:', err.message);
        }
    }

    /**
     * Broadcast cache invalidation across all backend cluster workers via Redis.
     */
    static async broadcastInvalidation(): Promise<void> {
        this.invalidateCache();
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                await redis.publish('worksphere:storage_config_invalidated', JSON.stringify({ timestamp: Date.now() }));
            }
        } catch {
            // Non-fatal if Redis is unreachable; local cache is already invalidated
        }
    }

    /**
     * Sign a storage key or CDN URL with active token authentication security.
     */
    static async signUrl(urlOrKey: string, expiresInSeconds = 3600): Promise<string> {
        if (!urlOrKey || !urlOrKey.trim()) return urlOrKey;
        // If it's a legacy or credentials-bearing Cloudinary URL, sanitize it immediately
        if (urlOrKey.startsWith('cloudinary://')) {
            const active = await this.getActiveConfiguration();
            return CloudinaryStorageProvider.toHttpsDeliveryUrl(
                urlOrKey,
                active?.configuration?.cloudName,
                active?.configuration?.deliveryUrl
            );
        }
        try {
            const active = await this.getActiveConfiguration();
            if (active && active.enabled) {
                const provider = StorageProviderFactory.createProvider(active.provider, active.configuration);
                if (typeof (provider as any).getSignedUrl === 'function') {
                    return (provider as any).getSignedUrl(urlOrKey, expiresInSeconds);
                }
                return provider.getFileUrl(urlOrKey);
            }
        } catch {
            // fallback
        }
        return urlOrKey;
    }

    /**
     * Get the active storage configuration from Cache, DB, or Environment Fallback.
     */
    static async getActiveConfiguration(): Promise<IStorageConfigurationDocument | any> {
        const now = Date.now();
        if (this.cachedConfig && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
            return this.cachedConfig;
        }

        const isMocked = Boolean(
            (StorageConfiguration.findOne as any)?.mock ||
            (StorageConfiguration.findOne as any)?._isMockFunction ||
            typeof (StorageConfiguration as any).__setMock === 'function'
        );

        if (isMocked || (mongoose.connection && mongoose.connection.readyState === 1)) {
            try {
                const config = await StorageConfiguration.findOne().sort({ updatedAt: -1 });
                if (config) {
                    // Sanitize any legacy cloudinary:// URLs stored in configuration
                    if (config.provider === 'CLOUDINARY' && config.configuration) {
                        const confObj = config.configuration as any;
                        if (confObj.deliveryUrl && String(confObj.deliveryUrl).startsWith('cloudinary://')) {
                            confObj.deliveryUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(confObj.deliveryUrl, confObj.cloudName);
                        }
                        if (confObj.pullZoneUrl && String(confObj.pullZoneUrl).startsWith('cloudinary://')) {
                            confObj.pullZoneUrl = confObj.deliveryUrl || (confObj.cloudName ? `https://res.cloudinary.com/${confObj.cloudName}` : '');
                        }
                    }
                    this.cachedConfig = config;
                    this.cacheTimestamp = now;
                    return config;
                }
            } catch (err) {
                console.error('[StorageConfig] Error reading config from MongoDB:', err);
            }
        }

        // Environment fallback
        const fallbackConfig: any = {
            provider: 'BUNNY' as StorageProviderEnum,
            enabled: Boolean(env.BUNNY_STORAGE_ZONE && env.BUNNY_STORAGE_ACCESS_KEY),
            configuration: {
                storageZone: env.BUNNY_STORAGE_ZONE || 'worksphere',
                accessKey: env.BUNNY_STORAGE_ACCESS_KEY || '',
                region: env.BUNNY_STORAGE_REGION || '',
                pullZoneUrl: env.BUNNY_PULL_ZONE_URL || '',
                basePath: env.BUNNY_STORAGE_BASE_PATH || 'worksphere',
            },
            limits: {
                imageMaxSizeMB: 15,
                documentMaxSizeMB: 30,
                audioMaxSizeMB: 30,
                videoMaxSizeMB: 100,
            },
            allowedTypes: {
                image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
                document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt'],
                audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
                video: ['mp4', 'mov', 'webm'],
            },
        };

        return fallbackConfig;
    }

    /**
     * Return safe configuration object with secrets masked for frontend consumption.
     */
    static toSafeResponse(config: any): any {
        const plain = config.toObject ? config.toObject() : { ...config };
        const provider = (plain.provider || 'BUNNY').toUpperCase();
        const conf = plain.configuration || {};

        let safeConfiguration: Record<string, any> = {};

        if (provider === 'CLOUDINARY') {
            const rawApiKey = String(conf.apiKey || '').trim();
            const rawApiSecret = String(conf.apiSecret || '').trim();
            let safeDeliveryUrl = String(conf.deliveryUrl || conf.pullZoneUrl || '').trim();
            if (safeDeliveryUrl.startsWith('cloudinary://')) {
                safeDeliveryUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(safeDeliveryUrl, conf.cloudName);
            }
            safeConfiguration = {
                cloudName: conf.cloudName || '',
                apiKey: rawApiKey ? (rawApiKey.length > 5 ? `${rawApiKey.slice(0, 3)}****${rawApiKey.slice(-2)}` : '****') : '',
                apiKeyConfigured: Boolean(rawApiKey.length > 0),
                apiSecretConfigured: Boolean(rawApiSecret.length > 0),
                deliveryUrl: safeDeliveryUrl,
                pullZoneUrl: safeDeliveryUrl,
                basePath: conf.basePath || 'worksphere',
            };
        } else if (provider === 'CLOUDFLARE_R2') {
            const rawKeyId = String(conf.accessKeyId || '').trim();
            const rawSecretKey = String(conf.secretAccessKey || '').trim();
            safeConfiguration = {
                accountId: conf.accountId || '',
                bucketName: conf.bucketName || conf.storageZone || '',
                accessKeyId: rawKeyId ? (rawKeyId.length > 6 ? `${rawKeyId.slice(0, 4)}****${rawKeyId.slice(-3)}` : '****') : '',
                accessKeyIdConfigured: Boolean(rawKeyId.length > 0),
                secretAccessKeyConfigured: Boolean(rawSecretKey.length > 0),
                publicDeliveryUrl: conf.publicDeliveryUrl || conf.pullZoneUrl || '',
                pullZoneUrl: conf.pullZoneUrl || conf.publicDeliveryUrl || '',
                endpoint: conf.endpoint || '',
                basePath: conf.basePath || 'worksphere',
            };
        } else {
            // BUNNY
            const rawKey = String(conf.accessKey || '').trim();
            const rawTokenKey = String(conf.tokenSecurityKey || '').trim();
            safeConfiguration = {
                storageZone: conf.storageZone || '',
                region: conf.region || '',
                pullZoneUrl: conf.pullZoneUrl || '',
                basePath: conf.basePath || 'worksphere',
                accessKeyConfigured: Boolean(rawKey.length > 0),
                tokenSecurityKeyConfigured: Boolean(rawTokenKey.length > 0),
                tokenExpirySeconds: conf.tokenExpirySeconds || 3600,
            };
        }

        return {
            _id: plain._id,
            provider,
            enabled: plain.enabled,
            configuration: safeConfiguration,
            limits: plain.limits,
            allowedTypes: plain.allowedTypes,
            updatedAt: plain.updatedAt,
            createdAt: plain.createdAt,
        };
    }

    /**
     * Test a storage configuration candidate by uploading, verifying, and deleting a test file.
     */
    static async testConfiguration(
        providerType: string,
        configuration: Record<string, any>
    ): Promise<{ success: boolean; message: string; details?: string }> {
        const provider = (providerType || 'BUNNY').toUpperCase().trim();
        const conf = { ...configuration };

        try {
            // Fetch existing stored configuration to backfill omitted secrets
            let existing: any = null;
            try {
                existing = await StorageConfiguration.findOne().sort({ updatedAt: -1 });
            } catch {
                // Ignore DB error during test if running in memory
            }
            const existingConf = existing?.configuration || {};

            if (provider === 'CLOUDINARY') {
                if (!conf.cloudName) {
                    return { success: false, message: 'Cloud Name is required for Cloudinary.' };
                }
                // Backfill omitted credentials from saved DB config
                if (!conf.apiKey || String(conf.apiKey).includes('*')) {
                    conf.apiKey = existingConf.apiKey;
                }
                if (!conf.apiSecret || String(conf.apiSecret).includes('*')) {
                    conf.apiSecret = existingConf.apiSecret;
                }
                if (!conf.apiKey || !conf.apiSecret) {
                    return { success: false, message: 'Cloudinary API Key and API Secret are required to test the configuration.' };
                }
            } else if (provider === 'CLOUDFLARE_R2') {
                const bucket = conf.bucketName || conf.storageZone;
                if (!conf.accountId || !bucket) {
                    return { success: false, message: 'Cloudflare Account ID and Bucket Name are required for Cloudflare R2.' };
                }
                conf.bucketName = bucket;
                // Backfill omitted credentials from saved DB config
                if (!conf.accessKeyId || String(conf.accessKeyId).includes('*')) {
                    conf.accessKeyId = existingConf.accessKeyId;
                }
                if (!conf.secretAccessKey || String(conf.secretAccessKey).includes('*')) {
                    conf.secretAccessKey = existingConf.secretAccessKey;
                }
                if (!conf.accessKeyId || !conf.secretAccessKey) {
                    return { success: false, message: 'Cloudflare R2 Access Key ID and Secret Access Key are required to test the configuration.' };
                }
            } else if (provider === 'BUNNY') {
                if (!conf.storageZone) {
                    return { success: false, message: 'Storage Zone name is required for BunnyCDN.' };
                }
                if (!conf.accessKey || String(conf.accessKey).includes('*')) {
                    conf.accessKey = existingConf.accessKey;
                }
                if (!conf.accessKey) {
                    return { success: false, message: 'BunnyCDN Access Key (Password) is required to test the configuration.' };
                }
                const rawKey = String(conf.accessKey || '').trim();
                if (rawKey.includes('•') || /^[•*]+$/.test(rawKey)) {
                    return {
                        success: false,
                        message: 'The Access Key entered is masked bullet dots ("••••"). In Bunny.net, please copy the actual password string.',
                    };
                }
            } else {
                return { success: false, message: `Unsupported storage provider "${provider}". Supported providers: BUNNY, CLOUDINARY, CLOUDFLARE_R2.` };
            }

            console.log(`[StorageTest] Testing ${provider} storage connectivity...`);

            const providerInstance = StorageProviderFactory.createProvider(provider, conf);
            const basePath = (conf.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
            const testKey = `${basePath}/temporary/test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.txt`;
            const testPayload = Buffer.from(`WorkSphere Storage Connectivity Test @ ${new Date().toISOString()}`);

            // 1. Upload test file
            const uploadResult = await providerInstance.uploadFile(testPayload, testKey, 'text/plain');
            if (!uploadResult || !uploadResult.storageKey) {
                return {
                    success: false,
                    message: `Upload verification failed for ${provider}: no storageKey returned.`,
                };
            }

            // 2. Check file exists
            let exists = await providerInstance.fileExists(uploadResult.storageKey);
            if (!exists && uploadResult.storageKey !== testKey) {
                exists = await providerInstance.fileExists(testKey);
            }
            if (!exists) {
                await providerInstance.deleteFile(uploadResult.storageKey).catch(() => {});
                await providerInstance.deleteFile(testKey).catch(() => {});
                return {
                    success: false,
                    message: `File existence verification failed for ${provider} after upload.`,
                };
            }

            // 3. Delete test file
            await providerInstance.deleteFile(uploadResult.storageKey).catch(() => {});
            if (uploadResult.storageKey !== testKey) {
                await providerInstance.deleteFile(testKey).catch(() => {});
            }

            if (provider === 'BUNNY' && typeof (providerInstance as any).getResolvedRegion === 'function') {
                configuration.region = (providerInstance as any).getResolvedRegion();
            }

            return {
                success: true,
                message: `${provider} storage connection tested and verified successfully.`,
            };
        } catch (error: any) {
            let message = `Connection test failed for ${provider}: ${error.message || 'Unknown error'}`;
            if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
                message += ' (HTTP 401 Unauthorized: Please check your credentials).';
            }
            return {
                success: false,
                message,
                details: error.stack,
            };
        }
    }

    /**
     * Update storage configuration with test-before-activate safety and audit history.
     */
    static async updateConfiguration(userId: string, data: any): Promise<any> {
        const existing = await StorageConfiguration.findOne().sort({ updatedAt: -1 });

        const provider = (data.provider || existing?.provider || 'BUNNY').toUpperCase().trim();
        const enabled = data.enabled !== undefined ? data.enabled : (existing?.enabled ?? true);

        // Merge configuration
        const existingConf: Record<string, any> = (existing?.configuration as any) || {};
        const newConf: Record<string, any> = data.configuration || {};

        const mergedConf: Record<string, any> = {
            ...existingConf,
            ...newConf,
            basePath: (newConf.basePath || existingConf.basePath || 'worksphere').replace(/^\/+|\/+$/g, ''),
        };

        if (provider === 'CLOUDINARY') {
            let extractedKey = '';
            let extractedSecret = '';
            let extractedCloud = '';

            const candidates = [newConf.cloudName, newConf.deliveryUrl, newConf.pullZoneUrl].filter(Boolean);
            for (const str of candidates) {
                const m = String(str).trim().match(/^cloudinary:\/\/(?:([^:]+):([^@]+)@)?([^/]+)/);
                if (m) {
                    if (m[1]) extractedKey = m[1];
                    if (m[2]) extractedSecret = m[2];
                    if (m[3]) extractedCloud = m[3];
                    break;
                }
            }

            const rawCloud = (newConf.cloudName ? newConf.cloudName.trim() : (existingConf.cloudName || extractedCloud || '')).replace(/^['"]|['"]$/g, '');
            mergedConf.cloudName = rawCloud.startsWith('cloudinary://')
                ? (extractedCloud || rawCloud.replace(/^cloudinary:\/\/(?:[^@]+@)?/, '').split('/')[0])
                : rawCloud;

            mergedConf.apiKey = (newConf.apiKey && !newConf.apiKey.includes('*'))
                ? newConf.apiKey.trim()
                : (extractedKey || existingConf.apiKey || '');

            mergedConf.apiSecret = (newConf.apiSecret && !newConf.apiSecret.includes('*'))
                ? newConf.apiSecret.trim()
                : (extractedSecret || existingConf.apiSecret || '');

            // Delivery URL must strictly be an HTTPS / HTTP URL, never cloudinary://
            let inputDelivery = (newConf.deliveryUrl !== undefined ? newConf.deliveryUrl : existingConf.deliveryUrl) || '';
            if (typeof inputDelivery === 'string' && inputDelivery.startsWith('cloudinary://')) {
                inputDelivery = '';
            }
            mergedConf.deliveryUrl = inputDelivery && /^https?:\/\//i.test(inputDelivery.trim())
                ? inputDelivery.trim().replace(/\/+$/, '')
                : undefined;
            mergedConf.pullZoneUrl = mergedConf.deliveryUrl || undefined;
        } else if (provider === 'CLOUDFLARE_R2') {
            mergedConf.accountId = newConf.accountId ? newConf.accountId.trim() : (existingConf.accountId || '');
            mergedConf.bucketName = (newConf.bucketName || newConf.storageZone) ? (newConf.bucketName || newConf.storageZone).trim() : (existingConf.bucketName || existingConf.storageZone || '');
            mergedConf.accessKeyId = (newConf.accessKeyId && !newConf.accessKeyId.includes('*'))
                ? newConf.accessKeyId.trim()
                : (existingConf.accessKeyId || '');
            mergedConf.secretAccessKey = (newConf.secretAccessKey && !newConf.secretAccessKey.includes('*'))
                ? newConf.secretAccessKey.trim()
                : (existingConf.secretAccessKey || '');
            mergedConf.publicDeliveryUrl = newConf.publicDeliveryUrl !== undefined
                ? (newConf.publicDeliveryUrl ? newConf.publicDeliveryUrl.trim() : undefined)
                : existingConf.publicDeliveryUrl;
            mergedConf.pullZoneUrl = newConf.pullZoneUrl || mergedConf.publicDeliveryUrl || existingConf.pullZoneUrl;
            mergedConf.endpoint = newConf.endpoint || existingConf.endpoint;
        } else {
            // BUNNY
            mergedConf.storageZone = newConf.storageZone ? newConf.storageZone.trim() : (existingConf.storageZone || '');
            mergedConf.accessKey = (newConf.accessKey && !newConf.accessKey.includes('*'))
                ? newConf.accessKey.trim()
                : (existingConf.accessKey || '');
            mergedConf.pullZoneUrl = newConf.pullZoneUrl ? newConf.pullZoneUrl.trim() : (existingConf.pullZoneUrl || '');
            mergedConf.region = newConf.region !== undefined ? newConf.region.trim() : existingConf.region;
            mergedConf.tokenSecurityKey = newConf.tokenSecurityKey !== undefined
                ? (newConf.tokenSecurityKey && newConf.tokenSecurityKey.trim().length > 0 ? newConf.tokenSecurityKey.trim() : undefined)
                : existingConf.tokenSecurityKey;
            mergedConf.tokenExpirySeconds = newConf.tokenExpirySeconds || existingConf.tokenExpirySeconds || 3600;
        }

        // Merge limits
        const mergedLimits = {
            ...(existing?.limits || {}),
            ...(data.limits || {}),
        };

        // Merge allowed types
        const mergedAllowedTypes = {
            ...(existing?.allowedTypes || {}),
            ...(data.allowedTypes || {}),
        };

        // Test configuration before activating if storage is enabled
        if (enabled) {
            if (provider === 'CLOUDINARY') {
                if (!mergedConf.cloudName || !mergedConf.apiKey || !mergedConf.apiSecret) {
                    throw new Error('Cannot enable Cloudinary: Cloud Name, API Key, and API Secret are required.');
                }
            } else if (provider === 'CLOUDFLARE_R2') {
                if (!mergedConf.accountId || !mergedConf.bucketName || !mergedConf.accessKeyId || !mergedConf.secretAccessKey) {
                    throw new Error('Cannot enable Cloudflare R2: Account ID, Bucket Name, Access Key ID, and Secret Access Key are required.');
                }
            } else if (provider === 'BUNNY') {
                if (!mergedConf.storageZone || !mergedConf.accessKey) {
                    throw new Error('Cannot enable BunnyCDN: Storage Zone Name and Access Key (Password) are required.');
                }
            } else {
                throw new Error(`Unsupported storage provider "${provider}". Supported providers: BUNNY, CLOUDINARY, CLOUDFLARE_R2.`);
            }

            const testResult = await this.testConfiguration(provider, mergedConf);
            if (!testResult.success) {
                throw new Error(
                    `Storage configuration test failed: ${testResult.message}. The existing active configuration was preserved.`
                );
            }
        }

        // Track changed fields for audit log
        const changedFields: string[] = [];
        if (existing) {
            if (existing.provider !== provider) changedFields.push('provider');
            if (existing.enabled !== enabled) changedFields.push('enabled');
            changedFields.push('configuration');
            if (data.limits) changedFields.push('limits');
            if (data.allowedTypes) changedFields.push('allowedTypes');
        } else {
            changedFields.push('initial_configuration');
        }

        let savedDoc: IStorageConfigurationDocument;
        if (existing) {
            existing.provider = provider as StorageProviderEnum;
            existing.enabled = enabled;
            existing.configuration = mergedConf as any;
            existing.limits = mergedLimits as any;
            existing.allowedTypes = mergedAllowedTypes as any;
            existing.updatedBy = new Types.ObjectId(userId);
            savedDoc = await existing.save();
        } else {
            savedDoc = await StorageConfiguration.create({
                provider: provider as StorageProviderEnum,
                enabled,
                configuration: mergedConf as any,
                limits: mergedLimits,
                allowedTypes: mergedAllowedTypes,
                createdBy: new Types.ObjectId(userId),
                updatedBy: new Types.ObjectId(userId),
            });
        }

        // Invalidate cache immediately and broadcast across workers
        await this.broadcastInvalidation();

        // Save audit history snapshot (safe snapshot without plaintext secrets)
        const safeSnapshot = this.toSafeResponse(savedDoc);
        await StorageConfigurationHistory.create({
            configurationId: savedDoc._id,
            provider: savedDoc.provider,
            changedBy: new Types.ObjectId(userId),
            changedAt: new Date(),
            changedFields,
            snapshot: safeSnapshot,
        }).catch((err) => console.error('[StorageConfig] Failed to record history:', err));

        return this.toSafeResponse(savedDoc);
    }

    /**
     * Get storage connection health status.
     */
    static async getHealth(): Promise<{
        provider: string;
        configured: boolean;
        connected: boolean;
        lastCheckedAt: string;
        status: 'HEALTHY' | 'UNHEALTHY' | 'DISABLED';
        message?: string;
    }> {
        const config = await this.getActiveConfiguration();
        if (!config || !config.enabled) {
            return {
                provider: config?.provider || 'NONE',
                configured: Boolean(config?.configuration?.storageZone || config?.configuration?.cloudName || config?.configuration?.accountId),
                connected: false,
                lastCheckedAt: new Date().toISOString(),
                status: 'DISABLED',
                message: 'Storage service is disabled or unconfigured.',
            };
        }

        const testResult = await this.testConfiguration(config.provider, config.configuration);
        return {
            provider: config.provider,
            configured: true,
            connected: testResult.success,
            lastCheckedAt: new Date().toISOString(),
            status: testResult.success ? 'HEALTHY' : 'UNHEALTHY',
            message: testResult.message,
        };
    }

    /**
     * Get configuration audit history.
     */
    static async getHistory(limit = 20): Promise<any[]> {
        return StorageConfigurationHistory.find()
            .populate('changedBy', 'name email')
            .sort({ changedAt: -1 })
            .limit(limit)
            .lean();
    }

    /**
     * Rollback configuration to a historical snapshot.
     */
    static async rollback(userId: string, historyId: string): Promise<any> {
        const historyItem = await StorageConfigurationHistory.findById(historyId);
        if (!historyItem) {
            throw new Error('History record not found');
        }

        const activeConfig = await this.getActiveConfiguration();
        const existingConf = activeConfig?.configuration || {};
        const snapshotConf = historyItem.snapshot.configuration || {};

        // Merge snapshot with existing secrets if snapshot had masked values
        const restoredConfigData = {
            provider: historyItem.snapshot.provider,
            enabled: historyItem.snapshot.enabled,
            configuration: {
                ...snapshotConf,
                accessKey: existingConf.accessKey || '',
                tokenSecurityKey: existingConf.tokenSecurityKey,
                apiKey: existingConf.apiKey || '',
                apiSecret: existingConf.apiSecret || '',
                accessKeyId: existingConf.accessKeyId || '',
                secretAccessKey: existingConf.secretAccessKey || '',
            },
            limits: historyItem.snapshot.limits,
            allowedTypes: historyItem.snapshot.allowedTypes,
        };

        return this.updateConfiguration(userId, restoredConfigData);
    }
}
export default StorageConfigurationService;
