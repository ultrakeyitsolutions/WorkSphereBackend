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

export interface IStorageConfiguration {
    provider: StorageProviderEnum;
    enabled: boolean;
    configuration: BunnyStorageSettings & Record<string, any>;
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
