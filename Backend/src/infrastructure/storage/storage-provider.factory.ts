import { StorageProvider } from './storage-provider.interface';
import { BunnyStorageProvider, BunnyConfig } from './providers/bunny-storage.provider';

export type StorageProviderType = 'BUNNY' | 'S3' | 'CLOUDFLARE_R2' | 'CLOUDINARY' | 'OTHER';

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
            default:
                throw new Error(
                    `Unsupported storage provider: "${providerType}". Supported providers: BUNNY.`
                );
        }
    }
}
