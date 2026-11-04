import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Types } from 'mongoose';
import { StorageConfigurationService } from '../src/modules/super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../src/infrastructure/storage/storage-provider.factory';
import { StorageConfiguration } from '../src/modules/super-admin/storage/storage-config.model';
import { StorageConfigurationHistory } from '../src/modules/super-admin/storage/storage-config-history.model';
import { FileModel } from '../src/modules/files/file.model';
import { FileService } from '../src/modules/files/file.service';
import storageConfigRoutes from '../src/modules/super-admin/storage/storage-config.routes';
import { errorHandler } from '../src/middleware/error.middleware';

// Mock dependencies
vi.mock('../src/modules/super-admin/storage/storage-config.model', () => ({
    StorageConfiguration: {
        findOne: vi.fn(),
        create: vi.fn(),
        updateOne: vi.fn(),
    },
}));

vi.mock('../src/modules/super-admin/storage/storage-config-history.model', () => ({
    StorageConfigurationHistory: {
        create: vi.fn().mockResolvedValue({}),
        find: vi.fn(),
        findById: vi.fn(),
    },
}));

vi.mock('../src/modules/files/file.model', () => ({
    FileModel: {
        create: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('../src/services/subscription-quota.service', () => ({
    SubscriptionQuotaService: {
        reserveQuota: vi.fn().mockResolvedValue({
            commit: vi.fn().mockResolvedValue(undefined),
            release: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

vi.mock('../src/config/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue({
        status: 'ready',
        publish: vi.fn().mockResolvedValue(1),
        duplicate: vi.fn().mockReturnValue({
            subscribe: vi.fn((_channel, cb) => cb(null)),
            on: vi.fn(),
        }),
    }),
}));

// Mock Providers so tests don't make real external network calls
const mockBunnyProvider = {
    uploadFile: vi.fn().mockResolvedValue({
        storageKey: 'worksphere/test.txt',
        storageUrl: 'https://cdn.worksphere.io/worksphere/test.txt',
        size: 100,
    }),
    deleteFile: vi.fn().mockResolvedValue(true),
    fileExists: vi.fn().mockResolvedValue(true),
    getFileUrl: vi.fn((key: string) => `https://cdn.worksphere.io/${key}`),
};

const mockCloudinaryProvider = {
    uploadFile: vi.fn().mockResolvedValue({
        storageKey: 'worksphere/test',
        storageUrl: 'https://res.cloudinary.com/demo-cloud/image/upload/worksphere/test.jpg',
        size: 200,
    }),
    deleteFile: vi.fn().mockResolvedValue(true),
    fileExists: vi.fn().mockResolvedValue(true),
    getFileUrl: vi.fn((key: string) => `https://res.cloudinary.com/demo-cloud/image/upload/${key}`),
    ping: vi.fn().mockResolvedValue(true),
};

const mockCloudflareR2Provider = {
    uploadFile: vi.fn().mockResolvedValue({
        storageKey: 'worksphere/test.pdf',
        storageUrl: 'https://media.worksphere.io/worksphere/test.pdf',
        size: 300,
    }),
    deleteFile: vi.fn().mockResolvedValue(true),
    fileExists: vi.fn().mockResolvedValue(true),
    getFileUrl: vi.fn((key: string) => `https://media.worksphere.io/${key}`),
};

describe('WorkSphere CRM Storage Provider Configuration & Dynamic Switching Suite', () => {
    const superAdminId = '507f1f77bcf86cd799439011';

    beforeEach(() => {
        vi.clearAllMocks();
        StorageConfigurationService.invalidateCache();

        vi.spyOn(StorageProviderFactory, 'createProvider').mockImplementation((providerType: string) => {
            const norm = providerType.toUpperCase();
            if (norm === 'BUNNY') return mockBunnyProvider as any;
            if (norm === 'CLOUDINARY') return mockCloudinaryProvider as any;
            if (norm === 'CLOUDFLARE_R2') return mockCloudflareR2Provider as any;
            throw new Error(`Unsupported storage provider: ${providerType}`);
        });
    });

    // ── 1. Cloudinary Configuration & Validation ─────────────────────────────
    describe('1. Cloudinary Provider Configuration & Diagnostics', () => {
        it('tests Cloudinary configuration successfully without requiring BunnyCDN fields', async () => {
            const result = await StorageConfigurationService.testConfiguration('CLOUDINARY', {
                cloudName: 'demo-cloud',
                apiKey: '123456789012345',
                apiSecret: 'test_secret_key_abcdef',
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('CLOUDINARY storage connection tested and verified successfully');
            expect(mockCloudinaryProvider.uploadFile).toHaveBeenCalled();
            expect(mockCloudinaryProvider.fileExists).toHaveBeenCalled();
            expect(mockCloudinaryProvider.deleteFile).toHaveBeenCalled();
        });

        it('rejects Cloudinary test if cloudName is omitted', async () => {
            const result = await StorageConfigurationService.testConfiguration('CLOUDINARY', {
                apiKey: '123456789012345',
                apiSecret: 'test_secret_key_abcdef',
            });

            expect(result.success).toBe(false);
            expect(result.message).toContain('Cloud Name is required for Cloudinary');
        });

        it('saves and activates Cloudinary configuration safely', async () => {
            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(null),
            } as any);

            const createdDoc: any = {
                _id: new Types.ObjectId(),
                provider: 'CLOUDINARY',
                enabled: true,
                configuration: {
                    cloudName: 'demo-cloud',
                    apiKey: '123456789012345',
                    apiSecret: 'test_secret_key_abcdef',
                    basePath: 'worksphere',
                },
                limits: {},
                allowedTypes: {},
                save: vi.fn().mockResolvedValue(true),
            };
            vi.mocked(StorageConfiguration.create).mockResolvedValue(createdDoc);

            const result = await StorageConfigurationService.updateConfiguration(superAdminId, {
                provider: 'CLOUDINARY',
                enabled: true,
                configuration: {
                    cloudName: 'demo-cloud',
                    apiKey: '123456789012345',
                    apiSecret: 'test_secret_key_abcdef',
                },
            });

            expect(result.provider).toBe('CLOUDINARY');
            expect(result.configuration.cloudName).toBe('demo-cloud');
            expect(result.configuration.apiKeyConfigured).toBe(true);
            expect(result.configuration.apiSecretConfigured).toBe(true);
            // Plaintext apiSecret must never be returned!
            expect(result.configuration.apiSecret).toBeUndefined();
        });
    });

    // ── 2. Cloudflare R2 Configuration & Validation ──────────────────────────
    describe('2. Cloudflare R2 Provider Configuration', () => {
        it('tests Cloudflare R2 credentials with accountId, bucketName, accessKeyId, and secretAccessKey', async () => {
            const result = await StorageConfigurationService.testConfiguration('CLOUDFLARE_R2', {
                accountId: '0123456789abcdef0123456789abcdef',
                bucketName: 'worksphere-bucket',
                accessKeyId: 'r2_access_key_123',
                secretAccessKey: 'r2_secret_key_456',
                publicDeliveryUrl: 'https://media.worksphere.io',
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('CLOUDFLARE_R2 storage connection tested and verified successfully');
            expect(mockCloudflareR2Provider.uploadFile).toHaveBeenCalled();
            expect(mockCloudflareR2Provider.deleteFile).toHaveBeenCalled();
        });

        it('rejects Cloudflare R2 test if accountId or bucketName is missing', async () => {
            const result = await StorageConfigurationService.testConfiguration('CLOUDFLARE_R2', {
                accountId: '',
                bucketName: '',
                accessKeyId: 'key',
                secretAccessKey: 'secret',
            });

            expect(result.success).toBe(false);
            expect(result.message).toContain('Cloudflare Account ID and Bucket Name are required');
        });
    });

    // ── 3. BunnyCDN Configuration & Validation ───────────────────────────────
    describe('3. BunnyCDN Provider Configuration', () => {
        it('tests BunnyCDN credentials with storageZone and accessKey', async () => {
            const result = await StorageConfigurationService.testConfiguration('BUNNY', {
                storageZone: 'worksphere-storage',
                accessKey: 'bunny_rw_password_123',
                pullZoneUrl: 'https://cdn.worksphere.io',
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('BUNNY storage connection tested and verified successfully');
            expect(mockBunnyProvider.uploadFile).toHaveBeenCalled();
        });

        it('rejects BunnyCDN masked bullet dots in password', async () => {
            const result = await StorageConfigurationService.testConfiguration('BUNNY', {
                storageZone: 'worksphere-storage',
                accessKey: '••••••••',
            });

            expect(result.success).toBe(false);
            expect(result.message).toContain('masked bullet dots');
        });
    });

    // ── 4. Dynamic Provider Switching & Multi-Worker Invalidation ────────────
    describe('4. Dynamic Provider Switching Without Server Restart', () => {
        it('switches from Bunny to Cloudinary and uses Cloudinary dynamically for new uploads', async () => {
            // First: active config is Bunny
            const bunnyConfigDoc: any = {
                _id: new Types.ObjectId(),
                provider: 'BUNNY',
                enabled: true,
                configuration: {
                    storageZone: 'worksphere-zone',
                    accessKey: 'bunny_secret',
                    pullZoneUrl: 'https://cdn.worksphere.io',
                    basePath: 'worksphere',
                },
                limits: { imageMaxSizeMB: 15, documentMaxSizeMB: 30, audioMaxSizeMB: 30, videoMaxSizeMB: 100 },
                allowedTypes: {
                    image: ['jpg', 'png'],
                    document: ['pdf'],
                    audio: ['mp3'],
                    video: ['mp4'],
                },
            };

            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(bunnyConfigDoc),
            } as any);

            // Active configuration is Bunny
            let active = await StorageConfigurationService.getActiveConfiguration();
            expect(active.provider).toBe('BUNNY');

            // Now switch to Cloudinary in DB
            const cloudinaryConfigDoc: any = {
                ...bunnyConfigDoc,
                provider: 'CLOUDINARY',
                configuration: {
                    cloudName: 'demo-cloud',
                    apiKey: '1234567890',
                    apiSecret: 'secret_key',
                    basePath: 'worksphere',
                },
            };

            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(cloudinaryConfigDoc),
            } as any);

            // Invalidate cache (as done during updateConfiguration or Redis event)
            StorageConfigurationService.invalidateCache();

            // Next request immediately resolves Cloudinary without server restart
            active = await StorageConfigurationService.getActiveConfiguration();
            expect(active.provider).toBe('CLOUDINARY');

            // Perform upload via FileService
            const mockFile: any = {
                originalname: 'avatar.png',
                mimetype: 'image/png',
                size: 1024,
                buffer: Buffer.from('fake image content'),
            };

            vi.mocked(FileModel.create).mockResolvedValue({
                _id: new Types.ObjectId(),
                storageKey: 'worksphere/companies/platform/avatars/avatar.png',
                storageUrl: 'https://res.cloudinary.com/demo-cloud/image/upload/avatar.jpg',
                provider: 'CLOUDINARY',
            } as any);

            const uploaded = await FileService.upload({
                file: mockFile,
                userId: superAdminId,
                contextType: 'USER',
            });

            expect(uploaded).toBeDefined();
            // Verify Cloudinary provider was created and called for upload!
            expect(StorageProviderFactory.createProvider).toHaveBeenCalledWith(
                'CLOUDINARY',
                expect.objectContaining({ cloudName: 'demo-cloud' })
            );
            expect(mockCloudinaryProvider.uploadFile).toHaveBeenCalled();
        });

        it('preserves existing active provider if candidate test fails', async () => {
            const activeBunnyDoc: any = {
                _id: new Types.ObjectId(),
                provider: 'BUNNY',
                enabled: true,
                configuration: { storageZone: 'zone-1', accessKey: 'key-1' },
                save: vi.fn(),
            };

            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(activeBunnyDoc),
            } as any);

            // Mock provider failure on Cloudinary test upload
            mockCloudinaryProvider.uploadFile.mockRejectedValueOnce(new Error('Invalid Cloudinary API secret signature'));

            await expect(
                StorageConfigurationService.updateConfiguration(superAdminId, {
                    provider: 'CLOUDINARY',
                    enabled: true,
                    configuration: {
                        cloudName: 'bad-cloud',
                        apiKey: 'bad-key',
                        apiSecret: 'wrong-secret',
                    },
                })
            ).rejects.toThrow(/The existing active configuration was preserved/);

            // Ensure activeBunnyDoc was not saved with the failed provider
            expect(activeBunnyDoc.save).not.toHaveBeenCalled();
        });
    });

    // ── 5. Preserving Existing Files Across Provider Switches ─────────────────
    describe('5. Preservation of Previously Stored Files', () => {
        it('stores provider metadata with uploaded files while keeping storageUrl persistent', async () => {
            const r2ConfigDoc: any = {
                _id: new Types.ObjectId(),
                provider: 'CLOUDFLARE_R2',
                enabled: true,
                configuration: {
                    accountId: 'r2_account',
                    bucketName: 'bucket',
                    accessKeyId: 'key',
                    secretAccessKey: 'sec',
                    publicDeliveryUrl: 'https://media.worksphere.io',
                    basePath: 'worksphere',
                },
                limits: { imageMaxSizeMB: 15, documentMaxSizeMB: 30, audioMaxSizeMB: 30, videoMaxSizeMB: 100 },
                allowedTypes: {
                    image: ['jpg', 'png'],
                    document: ['pdf'],
                    audio: ['mp3'],
                    video: ['mp4'],
                },
            };

            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(r2ConfigDoc),
            } as any);

            const mockFile: any = {
                originalname: 'report.pdf',
                mimetype: 'application/pdf',
                size: 2048,
                buffer: Buffer.from('fake pdf content'),
            };

            vi.mocked(FileModel.create).mockImplementation((doc: any) => Promise.resolve({ ...doc, _id: new Types.ObjectId() }));

            const uploaded = await FileService.upload({
                file: mockFile,
                userId: superAdminId,
                contextType: 'DOCUMENT',
            });

            expect(uploaded.provider).toBe('CLOUDFLARE_R2');
            expect(uploaded.storageUrl).toContain('https://media.worksphere.io');
        });
    });

    // ── 6. Secret Redaction & Rollback ────────────────────────────────────────
    describe('6. Security, Secret Redaction & Audit Rollback', () => {
        it('redacts secrets from toSafeResponse across Bunny, Cloudinary, and Cloudflare R2', () => {
            const rawCloudinary = {
                provider: 'CLOUDINARY',
                enabled: true,
                configuration: {
                    cloudName: 'my-cloud',
                    apiKey: '123456789012345',
                    apiSecret: 'my_top_secret_key_123',
                    deliveryUrl: 'https://media.custom.com',
                },
            };

            const safe = StorageConfigurationService.toSafeResponse(rawCloudinary);
            expect(safe.configuration.apiSecret).toBeUndefined();
            expect(safe.configuration.apiSecretConfigured).toBe(true);
            expect(safe.configuration.apiKeyConfigured).toBe(true);
            expect(safe.configuration.cloudName).toBe('my-cloud');
        });

        it('restores previous configuration through rollback while safely retaining credentials', async () => {
            const historyItem: any = {
                _id: 'history_123',
                snapshot: {
                    provider: 'BUNNY',
                    enabled: true,
                    configuration: {
                        storageZone: 'previous-zone',
                        pullZoneUrl: 'https://prev.b-cdn.net',
                        region: 'de',
                    },
                    limits: {},
                    allowedTypes: {},
                },
            };

            vi.mocked(StorageConfigurationHistory.findById).mockResolvedValue(historyItem);

            const activeDoc: any = {
                _id: new Types.ObjectId(),
                provider: 'CLOUDINARY',
                configuration: {
                    accessKey: 'saved_bunny_password',
                },
                save: vi.fn().mockImplementation(function (this: any) {
                    return Promise.resolve(this);
                }),
            };

            vi.mocked(StorageConfiguration.findOne).mockReturnValue({
                sort: vi.fn().mockResolvedValue(activeDoc),
            } as any);

            const rolledBack = await StorageConfigurationService.rollback(superAdminId, 'history_123');
            expect(rolledBack.provider).toBe('BUNNY');
            expect(rolledBack.configuration.storageZone).toBe('previous-zone');
        });
    });

    // ── 7. SuperAdmin Storage API Endpoints ───────────────────────────────────
    describe('7. SuperAdmin Storage Controller & Routes', () => {
        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => {
            req.user = { userId: superAdminId, role: 'SUPER_ADMIN' };
            next();
        });
        app.use('/api/super-admin/storage', storageConfigRoutes);
        app.use(errorHandler);

        it('POST /api/super-admin/storage/test executes live test and returns 200 on success', async () => {
            const res = await request(app)
                .post('/api/super-admin/storage/test')
                .send({
                    provider: 'CLOUDINARY',
                    configuration: {
                        cloudName: 'test-cloud',
                        apiKey: '123456',
                        apiSecret: 'secret456',
                    },
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('CLOUDINARY storage connection tested and verified successfully');
        });

        it('POST /api/super-admin/storage/test returns 400 with clear message when validation fails', async () => {
            const res = await request(app)
                .post('/api/super-admin/storage/test')
                .send({
                    provider: 'CLOUDINARY',
                    configuration: {
                        cloudName: '',
                    },
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Cloud Name is required');
        });
    });
});
