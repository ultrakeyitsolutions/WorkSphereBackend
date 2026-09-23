import { NOTIFICATION_TYPES } from '../notifications/notification.types';
import { SoundEventRegistryItem } from './notification-sound.types';

export const NOTIFICATION_SOUND_MAX_SIZE_MB = 5;

export const ALLOWED_AUDIO_MIME_TYPES = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/ogg',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/webm',
];

export const ALLOWED_AUDIO_EXTENSIONS = [
    'mp3',
    'wav',
    'ogg',
    'm4a',
    'aac',
    'webm',
];

export const DEFAULT_NOTIFICATION_SOUND_ID = 'default-bell';

export const NOTIFICATION_SOUND_PERMISSIONS = {
    READ: 'NOTIFICATION_SOUND_READ',
    CREATE: 'NOTIFICATION_SOUND_CREATE',
    UPDATE: 'NOTIFICATION_SOUND_UPDATE',
    DELETE: 'NOTIFICATION_SOUND_DELETE',
    CONFIGURE: 'NOTIFICATION_SOUND_CONFIGURE',
} as const;

/**
 * Central registry mapping notification types to friendly labels, categories, and descriptions.
 * Dynamically populated from NOTIFICATION_TYPES registry with category grouping.
 */
export const NOTIFICATION_EVENT_REGISTRY: Record<string, SoundEventRegistryItem> = Object.entries(
    NOTIFICATION_TYPES
).reduce((acc, [typeKey, typeDef]) => {
    acc[typeKey] = {
        type: typeKey,
        label: typeDef.defaultTitle || typeKey.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
        category: typeDef.category,
        description: typeDef.defaultMessage || '',
    };
    return acc;
}, {} as Record<string, SoundEventRegistryItem>);
