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
        thumbnailUrl?: string;
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

    /**
     * Get a secure signed URL with expiration for a given storage key.
     * @param storageKey Path / key within the storage provider
     * @param expiresInSeconds Optional expiry duration in seconds (default: 3600)
     */
    getSignedUrl?(storageKey: string, expiresInSeconds?: number): string;

    /**
     * Stream a file from storage, optionally with byte range headers for media playback.
     * @param storageKey Path / key within the storage provider
     * @param range Optional HTTP Range header string (e.g. 'bytes=0-1024')
     */
    getFileStream?(
        storageKey: string,
        range?: string
    ): Promise<{
        stream: NodeJS.ReadableStream | any;
        statusCode: number;
        headers: Record<string, string | number | undefined>;
    }>;
}
