import { Document, Types } from 'mongoose';

export type StorageProviderEnum = 'BUNNY' | 'S3' | 'CLOUDFLARE_R2' | 'CLOUDINARY' | 'OTHER';

export interface StorageLimits {
    imageMaxSizeMB: number;
    documentMaxSizeMB: number;
    audioMaxSizeMB: number;
    videoMaxSizeMB: number;
}

export interface StorageAllowedTypes {
    image: string[];
    document: string[];
    audio: string[];
    video: string[];
}

export interface BunnyStorageSettings {
    storageZone: string;
    accessKey: string;
    region?: string;
    pullZoneUrl: string;
    basePath?: string;
    tokenSecurityKey?: string;
    tokenExpirySeconds?: number;
}

export interface CloudinaryStorageSettings {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    pullZoneUrl?: string; // Optional custom delivery domain/URL
    deliveryUrl?: string; // e.g. https://res.cloudinary.com/<cloudName>
    basePath?: string;    // e.g. worksphere
}

export interface CloudflareR2StorageSettings {
    accountId: string;          // Cloudflare 32-char Account ID
    bucketName: string;         // Cloudflare R2 Bucket Name
    accessKeyId: string;        // Cloudflare R2 Token Access Key ID
    secretAccessKey: string;    // Cloudflare R2 Token Secret Access Key
    publicDeliveryUrl?: string; // Public R2.dev URL or Custom Domain (e.g. https://media.yourdomain.com)
    pullZoneUrl?: string;       // Alias for publicDeliveryUrl
    endpoint?: string;          // Optional custom endpoint override
    basePath?: string;          // e.g. worksphere
}

export type StorageConfigurationSettings =
    | (BunnyStorageSettings & Record<string, any>)
    | (CloudinaryStorageSettings & Record<string, any>)
    | (CloudflareR2StorageSettings & Record<string, any>)
    | Record<string, any>;

export interface IStorageConfiguration {
    provider: StorageProviderEnum;
    enabled: boolean;
    configuration: StorageConfigurationSettings;
    limits: StorageLimits;
    allowedTypes: StorageAllowedTypes;
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IStorageConfigurationDocument extends IStorageConfiguration, Document {}

export interface IStorageConfigurationHistory {
    configurationId: Types.ObjectId;
    provider: StorageProviderEnum;
    changedBy: Types.ObjectId;
    changedAt: Date;
    changedFields: string[];
    snapshot: Record<string, any>;
}

export interface IStorageConfigurationHistoryDocument extends IStorageConfigurationHistory, Document {}
