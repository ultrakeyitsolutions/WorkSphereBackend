import { Types } from 'mongoose';
import { StorageConfiguration } from './storage-config.model';
import { StorageConfigurationHistory } from './storage-config-history.model';
import {
    IStorageConfigurationDocument,
    StorageProviderEnum,
} from './storage-config.types';
import { StorageProviderFactory } from '../../../infrastructure/storage/storage-provider.factory';
import { env } from '../../../config/env';

export class StorageConfigurationService {
    // In-memory cache for ultra-fast access on file uploads
    private static cachedConfig: IStorageConfigurationDocument | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 60 * 1000; // 1 minute TTL fallback

    /**
     * Invalidate cached storage configuration.
     */
    static invalidateCache(): void {
        this.cachedConfig = null;
        this.cacheTimestamp = 0;
    }

    /**
     * Get the active storage configuration from Cache, DB, or Environment Fallback.
     */
    static async getActiveConfiguration(): Promise<IStorageConfigurationDocument | any> {
        const now = Date.now();
        if (this.cachedConfig && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
            return this.cachedConfig;
        }

        try {
            const config = await StorageConfiguration.findOne().sort({ updatedAt: -1 });
            if (config) {
                this.cachedConfig = config;
                this.cacheTimestamp = now;
                return config;
            }
        } catch (err) {
            console.error('[StorageConfig] Error reading config from MongoDB:', err);
        }

        // Fallback to environment variables if MongoDB record does not exist yet
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
        const rawKey = plain.configuration?.accessKey || '';
        return {
            _id: plain._id,
            provider: plain.provider,
            enabled: plain.enabled,
            configuration: {
                storageZone: plain.configuration?.storageZone || '',
                region: plain.configuration?.region || '',
                pullZoneUrl: plain.configuration?.pullZoneUrl || '',
                basePath: plain.configuration?.basePath || 'worksphere',
                accessKeyConfigured: Boolean(rawKey && rawKey.trim().length > 0),
            },
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
        try {
            // If accessKey is omitted in test payload, attempt to use active saved accessKey
            if (!configuration.accessKey) {
                const active = await this.getActiveConfiguration();
                if (active?.configuration?.accessKey) {
                    configuration.accessKey = active.configuration.accessKey;
                }
            }

            if (!configuration.accessKey) {
                return {
                    success: false,
                    message: 'Storage access key is required to test the configuration.',
                };
            }

            const provider = StorageProviderFactory.createProvider(providerType, configuration);
            const basePath = (configuration.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
            const testKey = `${basePath}/temporary/test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.txt`;
            const testPayload = Buffer.from(`WorkSphere Storage Connectivity Test @ ${new Date().toISOString()}`);

            // 1. Upload test file
            const uploadResult = await provider.uploadFile(testPayload, testKey, 'text/plain');
            if (!uploadResult || !uploadResult.storageKey) {
                return {
                    success: false,
                    message: 'Upload verification failed: no storageKey returned.',
                };
            }

            // 2. Check file exists
            const exists = await provider.fileExists(testKey);
            if (!exists) {
                // Attempt cleanup before returning error
                await provider.deleteFile(testKey).catch(() => {});
                return {
                    success: false,
                    message: 'File existence verification failed after upload.',
                };
            }

            // 3. Delete test file
            await provider.deleteFile(testKey);

            return {
                success: true,
                message: `${providerType} storage connection tested and verified successfully.`,
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Connection test failed: ${error.message || 'Unknown error'}`,
                details: error.stack,
            };
        }
    }

    /**
     * Update storage configuration with test-before-activate safety and audit history.
     */
    static async updateConfiguration(userId: string, data: any): Promise<any> {
        let existing = await StorageConfiguration.findOne().sort({ updatedAt: -1 });

        const provider = (data.provider || existing?.provider || 'BUNNY').toUpperCase();
        const enabled = data.enabled !== undefined ? data.enabled : (existing?.enabled ?? true);

        // Merge configuration
        const existingConf: Record<string, any> = (existing?.configuration as any) || {};
        const newConf: Record<string, any> = data.configuration || {};
        const mergedConf: Record<string, any> = {
            ...existingConf,
            ...newConf,
            // Retain existing access key if not provided in the update payload
            accessKey: newConf.accessKey && newConf.accessKey.trim().length > 0
                ? newConf.accessKey.trim()
                : existingConf.accessKey || '',
        };

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
            if (newConf.storageZone && newConf.storageZone !== existingConf.storageZone) changedFields.push('configuration.storageZone');
            if (newConf.accessKey && newConf.accessKey !== existingConf.accessKey) changedFields.push('configuration.accessKey');
            if (newConf.region && newConf.region !== existingConf.region) changedFields.push('configuration.region');
            if (newConf.pullZoneUrl && newConf.pullZoneUrl !== existingConf.pullZoneUrl) changedFields.push('configuration.pullZoneUrl');
            if (newConf.basePath && newConf.basePath !== existingConf.basePath) changedFields.push('configuration.basePath');
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
                provider,
                enabled,
                configuration: mergedConf as any,
                limits: mergedLimits,
                allowedTypes: mergedAllowedTypes,
                createdBy: new Types.ObjectId(userId),
                updatedBy: new Types.ObjectId(userId),
            });
        }

        // Invalidate cache immediately
        this.invalidateCache();

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
                configured: Boolean(config?.configuration?.storageZone),
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

        // The snapshot does not contain plaintext accessKey, so restore other fields while retaining current key
        const activeConfig = await this.getActiveConfiguration();
        const restoredConfigData = {
            provider: historyItem.snapshot.provider,
            enabled: historyItem.snapshot.enabled,
            configuration: {
                ...historyItem.snapshot.configuration,
                accessKey: activeConfig?.configuration?.accessKey || '',
            },
            limits: historyItem.snapshot.limits,
            allowedTypes: historyItem.snapshot.allowedTypes,
        };

        return this.updateConfiguration(userId, restoredConfigData);
    }
}
export default StorageConfigurationService;
