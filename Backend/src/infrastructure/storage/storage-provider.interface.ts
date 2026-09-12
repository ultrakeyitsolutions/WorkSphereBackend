export interface StorageProvider {
    /**
     * Upload a file buffer to storage.
     * @param buffer Raw file binary buffer
     * @param storageKey Unique path / key within the storage provider
     * @param mimeType Optional MIME type
     */
    uploadFile(
        buffer: Buffer,
        storageKey: string,
        mimeType?: string
    ): Promise<{
        storageKey: string;
        storageUrl: string;
        size: number;
    }>;

    /**
     * Delete a file from storage by storage key.
     * @param storageKey Path / key within the storage provider
     */
    deleteFile(storageKey: string): Promise<boolean>;

    /**
     * Check if a file exists in storage.
     * @param storageKey Path / key within the storage provider
     */
    fileExists(storageKey: string): Promise<boolean>;

    /**
     * Get the public CDN / access URL for a given storage key.
     * @param storageKey Path / key within the storage provider
     */
    getFileUrl(storageKey: string): string;
}
