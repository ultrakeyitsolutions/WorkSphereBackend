import { Document, Types } from 'mongoose';
import { NotificationCategory, NotificationType } from '../notifications/notification.types';

// ─── Sound Document Interface ───────────────────────────────────────────────

export interface IPlatformSounds {
    web?: string;
    android?: string;
    ios?: string;
}

export interface INotificationSound extends Document {
    _id: Types.ObjectId;
    soundId: string;
    name: string;
    description?: string;
    fileUrl: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    durationMs?: number;
    isActive: boolean;
    isDefault: boolean;
    platformSounds?: IPlatformSounds;
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Sound Mapping Document Interface ───────────────────────────────────────

export interface INotificationSoundMapping extends Document {
    _id: Types.ObjectId;
    notificationType: string;
    soundId: string | null;
    isEnabled: boolean;
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Resolved Sound Metadata ────────────────────────────────────────────────

export interface ResolvedSoundMetadata {
    enabled: boolean;
    soundId?: string;
    name?: string;
    url?: string;
    durationMs?: number;
    platformSounds?: IPlatformSounds;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface CreateNotificationSoundDto {
    soundId?: string;
    name: string;
    description?: string;
    durationMs?: number;
    isActive?: boolean;
    isDefault?: boolean;
    platformSounds?: IPlatformSounds;
}

export interface UpdateNotificationSoundDto {
    name?: string;
    description?: string;
    isActive?: boolean;
    isDefault?: boolean;
    durationMs?: number;
    platformSounds?: IPlatformSounds;
}

export interface UpdateNotificationSoundMappingDto {
    soundId: string | null;
    isEnabled: boolean;
}

export interface SetDefaultNotificationSoundDto {
    soundId: string;
}

export interface TestSoundDto {
    soundId: string;
}

export interface SoundEventRegistryItem {
    type: string;
    label: string;
    category: NotificationCategory | string;
    description?: string;
}
