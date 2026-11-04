import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudinaryStorageProvider } from '../src/infrastructure/storage/providers/cloudinary-storage.provider';
import { StorageConfigurationService } from '../src/modules/super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../src/infrastructure/storage/storage-provider.factory';

describe('Cloudinary Image Delivery & Credential Security', () => {
    describe('CloudinaryStorageProvider.toHttpsDeliveryUrl', () => {
        const cloudName = 'kjl8mluw';
        const apiKey = '284789218743471';
        const apiSecret = 'JuW_idnMpUFhx8y7Swn0fofFxzg';

        it('safely converts full cloudinary:// SDK URI with credentials into a canonical public HTTPS delivery URL', () => {
            const rawSdkUrl = `cloudinary://${apiKey}:${apiSecret}@${cloudName}/image/upload/v1793001200/worksphere/platform/logos/1793001197086-1cc92533-WhatsApp_Image.jpg`;

            const httpsUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(rawSdkUrl, cloudName);

            // Valid delivery URL
            expect(httpsUrl).toBe(
                `https://res.cloudinary.com/${cloudName}/image/upload/v1793001200/worksphere/platform/logos/1793001197086-1cc92533-WhatsApp_Image.jpg`
            );

            // Must NOT contain apiSecret or apiKey
            expect(httpsUrl).not.toContain(apiSecret);
            expect(httpsUrl).not.toContain(apiKey);
            expect(httpsUrl.startsWith('https://res.cloudinary.com')).toBe(true);
        });

        it('never blindly replaces cloudinary:// with https:// leaving credentials in URL', () => {
            const rawSdkUrl = `cloudinary://${apiKey}:${apiSecret}@${cloudName}/image/upload/v1234/test.png`;
            const blindReplacement = rawSdkUrl.replace('cloudinary://', 'https://');

            // Blind replacement contains credentials and invalid domain format
            expect(blindReplacement).toContain(apiSecret);
            expect(blindReplacement).toContain('@');

            // Our method safely extracts cloudName, discards credentials, and generates standard URL
            const safeUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(rawSdkUrl, cloudName);
            expect(safeUrl).toBe(`https://res.cloudinary.com/${cloudName}/image/upload/v1234/test.png`);
            expect(safeUrl).not.toContain(apiSecret);
            expect(safeUrl).not.toContain('@');
        });

        it('correctly resolves resource types for image, video, and raw files from storage keys', () => {
            // Image
            const imgKey = 'worksphere/logos/avatar.png';
            const imgUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(imgKey, cloudName);
            expect(imgUrl).toBe(`https://res.cloudinary.com/${cloudName}/image/upload/worksphere/logos/avatar.png`);

            // Video
            const videoKey = 'worksphere/videos/intro.mp4';
            const videoUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(videoKey, cloudName);
            expect(videoUrl).toBe(`https://res.cloudinary.com/${cloudName}/video/upload/worksphere/videos/intro.mp4`);

            // Raw document
            const rawKey = 'worksphere/documents/policy.pdf';
            const rawUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(rawKey, cloudName);
            expect(rawUrl).toBe(`https://res.cloudinary.com/${cloudName}/raw/upload/worksphere/documents/policy.pdf`);
        });

        it('leaves existing valid HTTPS URLs unchanged', () => {
            const validUrl = 'https://res.cloudinary.com/kjl8mluw/image/upload/v1234/worksphere/logos/logo.png';
            expect(CloudinaryStorageProvider.toHttpsDeliveryUrl(validUrl, cloudName)).toBe(validUrl);
        });

        it('leaves BunnyCDN and Cloudflare R2 URLs completely untouched', () => {
            const bunnyUrl = 'https://worksphere.b-cdn.net/worksphere/logos/logo.png';
            const r2Url = 'https://pub-12345.r2.dev/worksphere/logos/logo.png';

            expect(CloudinaryStorageProvider.toHttpsDeliveryUrl(bunnyUrl)).toBe(bunnyUrl);
            expect(CloudinaryStorageProvider.toHttpsDeliveryUrl(r2Url)).toBe(r2Url);
        });

        it('handles custom CDN delivery URL for Cloudinary if configured with valid HTTPS', () => {
            const customDelivery = 'https://cdn.mycompany.com';
            const storageKey = 'worksphere/logos/logo.png';
            const customUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(storageKey, cloudName, customDelivery);

            expect(customUrl).toBe('https://cdn.mycompany.com/worksphere/logos/logo.png');
        });

        it('rejects cloudinary:// as custom delivery URL and falls back to canonical HTTPS', () => {
            const invalidDelivery = `cloudinary://${apiKey}:${apiSecret}@${cloudName}`;
            const storageKey = 'worksphere/logos/logo.png';
            const safeUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(storageKey, cloudName, invalidDelivery);

            expect(safeUrl).toBe(`https://res.cloudinary.com/${cloudName}/image/upload/worksphere/logos/logo.png`);
            expect(safeUrl).not.toContain('cloudinary://');
            expect(safeUrl).not.toContain(apiSecret);
        });
    });

    describe('CloudinaryStorageProvider Constructor Sanitization', () => {
        it('cleanses deliveryUrl if set to cloudinary:// connection string', () => {
            const provider = new CloudinaryStorageProvider({
                cloudName: 'kjl8mluw',
                apiKey: '284789218743471',
                apiSecret: 'JuW_idnMpUFhx8y7Swn0fofFxzg',
                deliveryUrl: 'cloudinary://284789218743471:JuW_idnMpUFhx8y7Swn0fofFxzg@kjl8mluw',
            });

            // Calling getFileUrl should return public HTTPS URL and not the cloudinary:// string
            const fileUrl = provider.getFileUrl('worksphere/logos/test.jpg');
            expect(fileUrl).toBe('https://res.cloudinary.com/kjl8mluw/image/upload/worksphere/logos/test.jpg');
            expect(fileUrl).not.toContain('cloudinary://');
            expect(fileUrl).not.toContain('JuW_idnMpUFhx8y7Swn0fofFxzg');
        });
    });

    describe('StorageConfigurationService.toSafeResponse', () => {
        it('removes Cloudinary apiSecret and masks apiKey in safe API response', () => {
            const rawDbConfig = {
                _id: '6aa51eb16aa7aa2180130f16',
                provider: 'CLOUDINARY',
                enabled: true,
                configuration: {
                    cloudName: 'kjl8mluw',
                    apiKey: '284789218743471',
                    apiSecret: 'JuW_idnMpUFhx8y7Swn0fofFxzg',
                    deliveryUrl: 'cloudinary://284789218743471:JuW_idnMpUFhx8y7Swn0fofFxzg@kjl8mluw',
                    pullZoneUrl: 'cloudinary://284789218743471:JuW_idnMpUFhx8y7Swn0fofFxzg@kjl8mluw',
                    basePath: 'worksphere',
                },
                limits: {},
                allowedTypes: {},
            };

            const safe = StorageConfigurationService.toSafeResponse(rawDbConfig);

            // Secret must NEVER be present
            expect(safe.configuration.apiSecret).toBeUndefined();
            expect(safe.configuration.apiSecretConfigured).toBe(true);

            // API key must be masked
            expect(safe.configuration.apiKey).toBe('284****71');
            expect(safe.configuration.apiKeyConfigured).toBe(true);

            // deliveryUrl and pullZoneUrl must NOT contain cloudinary:// or credentials
            expect(safe.configuration.deliveryUrl).not.toContain('cloudinary://');
            expect(safe.configuration.deliveryUrl).not.toContain('JuW_idnMpUFhx8y7Swn0fofFxzg');
            expect(safe.configuration.pullZoneUrl).not.toContain('cloudinary://');
            expect(safe.configuration.deliveryUrl).toBe('https://res.cloudinary.com/kjl8mluw');
            expect(safe.configuration.pullZoneUrl).toBe('https://res.cloudinary.com/kjl8mluw');
        });
    });

    describe('StorageConfigurationService.signUrl', () => {
        it('safely resolves legacy cloudinary:// URLs into HTTPS URLs', async () => {
            const rawLegacyUrl = 'cloudinary://284789218743471:JuW_idnMpUFhx8y7Swn0fofFxzg@kjl8mluw/image/upload/v1793001200/worksphere/platform/logos/sample.jpg';
            const signed = await StorageConfigurationService.signUrl(rawLegacyUrl);

            expect(signed).toBe('https://res.cloudinary.com/kjl8mluw/image/upload/v1793001200/worksphere/platform/logos/sample.jpg');
            expect(signed).not.toContain('cloudinary://');
            expect(signed).not.toContain('JuW_idnMpUFhx8y7Swn0fofFxzg');
        });
    });

    describe('Multi-provider preservation', () => {
        it('creates BunnyCDN and Cloudflare R2 providers correctly without regression', () => {
            const bunny = StorageProviderFactory.createProvider('BUNNY', {
                storageZone: 'myzone',
                accessKey: 'mykey',
                pullZoneUrl: 'https://myzone.b-cdn.net',
            });
            expect(bunny.getFileUrl('path/to/file.jpg')).toBe('https://myzone.b-cdn.net/path/to/file.jpg');

            const r2 = StorageProviderFactory.createProvider('CLOUDFLARE_R2', {
                accountId: 'acc123',
                bucketName: 'mybucket',
                accessKeyId: 'key123',
                secretAccessKey: 'sec123',
                publicDeliveryUrl: 'https://pub-r2.dev',
            });
            expect(r2.getFileUrl('path/to/file.jpg')).toBe('https://pub-r2.dev/path/to/file.jpg');
        });
    });
});
