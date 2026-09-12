import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageConfigurationService } from '../src/modules/super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../src/infrastructure/storage/storage-provider.factory';
import { BunnyStorageProvider } from '../src/infrastructure/storage/providers/bunny-storage.provider';
import { validateUploadedFile } from '../src/modules/files/file.validator';

vi.mock('../src/modules/super-admin/storage/storage-config.model', () => {
    class MockStorageConfig {
        _id = 'storage_cfg_123';
        provider = 'BUNNY';
        enabled = true;
        configuration = {
            storageZone: 'test-zone',
            accessKey: 'secret_key_12345',
            region: 'sg',
            pullZoneUrl: 'https://test-cdn.b-cdn.net',
            basePath: 'worksphere',
        };
        limits = {
            imageMaxSizeMB: 15,
            documentMaxSizeMB: 30,
            audioMaxSizeMB: 30,
            videoMaxSizeMB: 100,
        };
        allowedTypes = {
            image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
            document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt'],
            audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
            video: ['mp4', 'mov', 'webm'],
        };
        updatedAt = new Date();
        createdAt = new Date();

        constructor(data?: any) {
            if (data) Object.assign(this, data);
        }

        async save() {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            storedConfig = this;
            return this;
        }

        toObject() {
            return { ...this };
        }

        static findOne = vi.fn().mockReturnValue({
            sort: vi.fn().mockImplementation(() => Promise.resolve(storedConfig)),
        });

        static create = vi.fn().mockImplementation(async (data: any) => {
            const instance = new MockStorageConfig(data);
            storedConfig = instance;
            return instance;
        });

        static __setMock = (cfg: any) => {
            storedConfig = cfg;
        };

        static __reset = () => {
            storedConfig = new MockStorageConfig();
        };
    }

    let storedConfig: any = new MockStorageConfig();

    return {
        StorageConfiguration: MockStorageConfig,
        default: MockStorageConfig,
    };
});

vi.mock('../src/modules/super-admin/storage/storage-config-history.model', () => {
    return {
        StorageConfigurationHistory: {
            create: vi.fn().mockResolvedValue({ _id: 'history_123' }),
            find: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    sort: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            }),
            findById: vi.fn().mockResolvedValue({
                _id: 'history_123',
                snapshot: {
                    provider: 'BUNNY',
                    enabled: true,
                    configuration: {
                        storageZone: 'restored-zone',
                        region: 'ny',
                        pullZoneUrl: 'https://restored.b-cdn.net',
                        basePath: 'worksphere',
                    },
                    limits: {
                        imageMaxSizeMB: 25,
                        documentMaxSizeMB: 50,
                        audioMaxSizeMB: 50,
                        videoMaxSizeMB: 200,
                    },
                    allowedTypes: {
                        image: ['jpg', 'png'],
                        document: ['pdf'],
                        audio: ['mp3'],
                        video: ['mp4'],
                    },
                },
            }),
        },
    };
});

describe('Super Admin Storage Configuration & Provider Architecture', () => {
    beforeEach(() => {
        StorageConfigurationService.invalidateCache();
        vi.clearAllMocks();
    });

    it('Security: Access key must be masked in safe response', async () => {
        const config = await StorageConfigurationService.getActiveConfiguration();
        const safe = StorageConfigurationService.toSafeResponse(config);

        expect(safe.configuration.accessKey).toBeUndefined();
        expect(safe.configuration.accessKeyConfigured).toBe(true);
        expect(safe.configuration.storageZone).toBe('test-zone');
        expect(safe.configuration.region).toBe('sg');
    });

    it('Factory: Should correctly instantiate BunnyStorageProvider', () => {
        const provider = StorageProviderFactory.createProvider('BUNNY', {
            storageZone: 'my-zone',
            accessKey: 'my-key',
            region: 'sg',
            pullZoneUrl: 'https://my-zone.b-cdn.net',
        });

        expect(provider).toBeInstanceOf(BunnyStorageProvider);
        const url = provider.getFileUrl('documents/report.pdf');
        expect(url).toBe('https://my-zone.b-cdn.net/documents/report.pdf');
    });

    it('Validation: Enforces security denylist against dangerous executables', () => {
        const limits = {
            imageMaxSizeMB: 15,
            documentMaxSizeMB: 30,
            audioMaxSizeMB: 30,
            videoMaxSizeMB: 100,
        };
        const allowedTypes = {
            image: ['jpg', 'png'],
            document: ['pdf', 'doc'],
            audio: ['mp3'],
            video: ['mp4'],
        };

        const resultExe = validateUploadedFile('malware.exe', 'application/x-msdownload', 1024, limits, allowedTypes);
        expect(resultExe.valid).toBe(false);
        expect(resultExe.error).toContain('blocked for security reasons');

        const resultBat = validateUploadedFile('script.bat', 'text/plain', 512, limits, allowedTypes);
        expect(resultBat.valid).toBe(false);
        expect(resultBat.error).toContain('blocked for security reasons');
    });

    it('Validation: Enforces configurable file size limits dynamically', () => {
        const limits = {
            imageMaxSizeMB: 10,
            documentMaxSizeMB: 20,
            audioMaxSizeMB: 20,
            videoMaxSizeMB: 50,
        };
        const allowedTypes = {
            image: ['jpg', 'png'],
            document: ['pdf'],
            audio: ['mp3'],
            video: ['mp4'],
        };

        // 12 MB image exceeds 10 MB limit
        const resultOversize = validateUploadedFile('photo.jpg', 'image/jpeg', 12 * 1024 * 1024, limits, allowedTypes);
        expect(resultOversize.valid).toBe(false);
        expect(resultOversize.error).toContain('exceeds the configured maximum limit of 10 MB');

        // 5 MB image passes
        const resultValid = validateUploadedFile('photo.jpg', 'image/jpeg', 5 * 1024 * 1024, limits, allowedTypes);
        expect(resultValid.valid).toBe(true);
        expect(resultValid.category).toBe('image');
    });

    it('Health Check: Reports healthy status when provider connectivity test succeeds', async () => {
        vi.spyOn(StorageConfigurationService, 'testConfiguration').mockResolvedValue({
            success: true,
            message: 'Connection verified',
        });

        const health = await StorageConfigurationService.getHealth();
        expect(health.status).toBe('HEALTHY');
        expect(health.connected).toBe(true);
        expect(health.configured).toBe(true);
        expect(health.provider).toBe('BUNNY');
    });
});
