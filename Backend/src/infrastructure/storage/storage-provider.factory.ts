import { StorageProvider } from './storage-provider.interface';
import { BunnyStorageProvider, BunnyConfig } from './providers/bunny-storage.provider';
import { CloudinaryStorageProvider, CloudinaryConfig } from './providers/cloudinary-storage.provider';
import { CloudflareR2StorageProvider, CloudflareR2Config } from './providers/cloudflare-r2-storage.provider';

export type StorageProviderType = 'BUNNY' | 'CLOUDINARY' | 'CLOUDFLARE_R2';

export class StorageProviderFactory {
    /**
     * Create a concrete StorageProvider based on provider type and its configuration.
     */
    static createProvider(
        providerType: string,
        configuration: Record<string, any>
    ): StorageProvider {
        const normalized = (providerType || '').toUpperCase().trim();

        switch (normalized) {
            case 'BUNNY':
                return new BunnyStorageProvider(configuration as BunnyConfig);
            case 'CLOUDINARY':
                return new CloudinaryStorageProvider(configuration as CloudinaryConfig);
            case 'CLOUDFLARE_R2':
                return new CloudflareR2StorageProvider(configuration as CloudflareR2Config);
            default:
                throw new Error(
                    `Unsupported storage provider: "${providerType}". Supported providers: BUNNY, CLOUDINARY, CLOUDFLARE_R2.`
                );
        }
    }
}
