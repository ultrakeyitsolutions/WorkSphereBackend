import { Types } from 'mongoose';
import { NotificationSoundMapping } from './notification-sound-mapping.model';
import { NotificationSound } from './notification-sound.model';
import {
    INotificationSoundMapping,
    ResolvedSoundMetadata,
    UpdateNotificationSoundMappingDto,
} from './notification-sound.types';
import {
    NOTIFICATION_EVENT_REGISTRY,
    DEFAULT_NOTIFICATION_SOUND_ID,
} from './notification-sound.constants';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NOTIFICATION_TYPES } from '../notifications/notification.types';

export class NotificationSoundService {
    // ─── High-Performance In-Memory Cache ──────────────────────────────────────
    private static cachedMappings: Map<string, ResolvedSoundMetadata> | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 60 * 1000; // 1 minute TTL fallback

    /**
     * Clear and invalidate all cached sound resolutions.
     */
    static invalidateCache(): void {
        this.cachedMappings = null;
        this.cacheTimestamp = 0;
    }

    /**
     * Prewarm / rebuild the sound resolution cache.
     */
    private static async getOrBuildCache(): Promise<Map<string, ResolvedSoundMetadata>> {
        const now = Date.now();
        if (this.cachedMappings && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
            return this.cachedMappings;
        }

        const cache = new Map<string, ResolvedSoundMetadata>();

        try {
            // 1. Fetch active sounds dictionary
            const activeSounds = await NotificationSound.find({
                isActive: true,
                deletedAt: null,
            }).lean();

            const soundMap = new Map<string, any>();
            let defaultSound: any = null;

            for (const s of activeSounds) {
                soundMap.set(s.soundId, s);
                if (s.isDefault) {
                    defaultSound = s;
                }
            }

            if (!defaultSound) {
                defaultSound = soundMap.get(DEFAULT_NOTIFICATION_SOUND_ID) || activeSounds[0] || null;
            }

            const defaultMetadata: ResolvedSoundMetadata = defaultSound
                ? {
                    enabled: true,
                    soundId: defaultSound.soundId,
                    name: defaultSound.name,
                    url: defaultSound.fileUrl,
                    durationMs: defaultSound.durationMs || 0,
                    platformSounds: defaultSound.platformSounds || {},
                }
                : { enabled: false };

            // 2. Fetch all mappings
            const mappings = await NotificationSoundMapping.find().lean();
            const explicitMappings = new Map<string, any>();
            for (const m of mappings) {
                explicitMappings.set(m.notificationType, m);
            }

            // 3. Resolve for each known notification type in registry
            const allTypes = Object.keys(NOTIFICATION_TYPES);
            for (const typeKey of allTypes) {
                const mapping = explicitMappings.get(typeKey);
                if (mapping) {
                    if (!mapping.isEnabled) {
                        cache.set(typeKey, { enabled: false });
                        continue;
                    }

                    if (mapping.soundId && soundMap.has(mapping.soundId)) {
                        const s = soundMap.get(mapping.soundId);
                        cache.set(typeKey, {
                            enabled: true,
                            soundId: s.soundId,
                            name: s.name,
                            url: s.fileUrl,
                            durationMs: s.durationMs || 0,
                            platformSounds: s.platformSounds || {},
                        });
                        continue;
                    }
                }

                // Fallback to default
                cache.set(typeKey, defaultMetadata);
            }

            this.cachedMappings = cache;
            this.cacheTimestamp = now;
        } catch (err) {
            console.error('[NotificationSoundService] Error building sound cache:', err);
        }

        return cache;
    }

    /**
     * Resolves the sound configuration for a given notification type.
     * Guaranteed to never throw or block notification creation.
     */
    static async resolveNotificationSound(notificationType: string): Promise<ResolvedSoundMetadata> {
        try {
            const cache = await this.getOrBuildCache();
            const cached = cache.get(notificationType);
            if (cached) {
                return cached;
            }

            // If not found in cache (e.g. newly added type), do dynamic fallback lookup
            const mapping = await NotificationSoundMapping.findOne({ notificationType }).lean();
            if (mapping && !mapping.isEnabled) {
                return { enabled: false };
            }

            if (mapping && mapping.soundId) {
                const sound = await NotificationSound.findOne({
                    soundId: mapping.soundId,
                    isActive: true,
                    deletedAt: null,
                }).lean();

                if (sound) {
                    return {
                        enabled: true,
                        soundId: sound.soundId,
                        name: sound.name,
                        url: sound.fileUrl,
                        durationMs: sound.durationMs || 0,
                        platformSounds: sound.platformSounds || {},
                    };
                }
            }

            // Fallback to default sound
            const defaultSound = await NotificationSound.findOne({
                isDefault: true,
                isActive: true,
                deletedAt: null,
            }).lean();

            if (defaultSound) {
                return {
                    enabled: true,
                    soundId: defaultSound.soundId,
                    name: defaultSound.name,
                    url: defaultSound.fileUrl,
                    durationMs: defaultSound.durationMs || 0,
                    platformSounds: defaultSound.platformSounds || {},
                };
            }

            return { enabled: false };
        } catch (err) {
            console.warn(`[NotificationSoundService] Sound resolution failed for "${notificationType}":`, err);
            return { enabled: false };
        }
    }

    /**
     * Get all notification event mappings enriched with sound details and category metadata.
     */
    static async getAllMappings(): Promise<any[]> {
        const [mappings, sounds] = await Promise.all([
            NotificationSoundMapping.find().lean(),
            NotificationSound.find({ deletedAt: null }).lean(),
        ]);

        const soundMap = new Map<string, any>(sounds.map((s) => [s.soundId, s]));
        const mappingMap = new Map<string, INotificationSoundMapping>(
            mappings.map((m) => [m.notificationType, m as any])
        );

        const result: any[] = [];

        for (const [typeKey, registryItem] of Object.entries(NOTIFICATION_EVENT_REGISTRY)) {
            const m = mappingMap.get(typeKey);
            const sound = m?.soundId ? soundMap.get(m.soundId) : null;

            result.push({
                notificationType: typeKey,
                label: registryItem.label,
                category: registryItem.category,
                description: registryItem.description,
                isEnabled: m ? m.isEnabled : true,
                soundId: m?.soundId || null,
                sound: sound
                    ? {
                        soundId: sound.soundId,
                        name: sound.name,
                        fileUrl: sound.fileUrl,
                        durationMs: sound.durationMs,
                        isActive: sound.isActive,
                    }
                    : null,
                updatedAt: m?.updatedAt || null,
            });
        }

        return result;
    }

    /**
     * Get mapping for a specific notification type.
     */
    static async getMappingForType(notificationType: string): Promise<any> {
        const cleanType = notificationType.toUpperCase().trim();
        const typeDef = NOTIFICATION_TYPES[cleanType as keyof typeof NOTIFICATION_TYPES];
        const registryItem = NOTIFICATION_EVENT_REGISTRY[cleanType] || (typeDef ? {
            type: cleanType,
            label: typeDef.defaultTitle || cleanType,
            category: typeDef.category,
            description: typeDef.defaultMessage || '',
        } : null);

        if (!registryItem) {
            throw new Error(`Notification type "${notificationType}" is not registered in WorkSphere.`);
        }

        const mapping = await NotificationSoundMapping.findOne({
            notificationType: cleanType,
        }).lean();

        let sound = null;
        if (mapping?.soundId) {
            sound = await NotificationSound.findOne({
                soundId: mapping.soundId,
                deletedAt: null,
            }).lean();
        }

        return {
            notificationType: cleanType,
            label: registryItem.label,
            category: registryItem.category,
            description: registryItem.description,
            isEnabled: mapping ? mapping.isEnabled : true,
            soundId: mapping?.soundId || null,
            sound: sound
                ? {
                    soundId: sound.soundId,
                    name: sound.name,
                    fileUrl: sound.fileUrl,
                    durationMs: sound.durationMs,
                    isActive: sound.isActive,
                }
                : null,
            updatedAt: mapping?.updatedAt || null,
        };
    }

    /**
     * Create or update mapping for a notification type.
     */
    static async updateMapping(
        notificationType: string,
        dto: UpdateNotificationSoundMappingDto,
        userContext?: { userId: string; role?: string; email?: string }
    ): Promise<any> {
        const cleanType = notificationType.toUpperCase().trim();

        if (!NOTIFICATION_TYPES[cleanType as keyof typeof NOTIFICATION_TYPES] && !NOTIFICATION_EVENT_REGISTRY[cleanType]) {
            throw new Error(`Invalid or unregistered notification type: "${notificationType}".`);
        }

        let validatedSoundId: string | null = null;

        if (dto.soundId) {
            const cleanSoundId = dto.soundId.toLowerCase().trim();
            const sound = await NotificationSound.findOne({
                soundId: cleanSoundId,
                deletedAt: null,
            });

            if (!sound) {
                throw new Error(`Notification sound with soundId "${dto.soundId}" does not exist.`);
            }

            if (!sound.isActive) {
                throw new Error(`Cannot assign inactive sound "${sound.name}" to notification event.`);
            }

            validatedSoundId = sound.soundId;
        }

        const actorObjId = userContext?.userId ? new Types.ObjectId(userContext.userId) : undefined;

        await NotificationSoundMapping.findOneAndUpdate(
            { notificationType: cleanType },
            {
                $set: {
                    soundId: validatedSoundId,
                    isEnabled: dto.isEnabled !== undefined ? dto.isEnabled : true,
                    updatedBy: actorObjId,
                },
                $setOnInsert: {
                    createdBy: actorObjId,
                },
            },
            { upsert: true, new: true, runValidators: true }
        );

        // Invalidate cache immediately
        this.invalidateCache();

        // Audit Log
        if (userContext?.userId) {
            const action = !dto.isEnabled
                ? AuditAction.NOTIFICATION_SOUND_DISABLED
                : AuditAction.NOTIFICATION_SOUND_MAPPING_UPDATED;

            await AuditLogService.log({
                action,
                actorId: userContext.userId,
                actorEmail: userContext.email || null,
                actorRole: userContext.role || 'SUPER_ADMIN',
                targetUserId: null,
                companyId: null,
                metadata: {
                    notificationType: cleanType,
                    soundId: validatedSoundId,
                    isEnabled: dto.isEnabled,
                },
                success: true,
                description: `Updated notification sound mapping for "${cleanType}" -> ${validatedSoundId || 'none'} (enabled: ${dto.isEnabled})`,
            });
        }

        return this.getMappingForType(cleanType);
    }

    /**
     * Test a sound by validating its existence and returning preview metadata.
     */
    static async testSound(soundId: string): Promise<ResolvedSoundMetadata> {
        const cleanSoundId = soundId.toLowerCase().trim();
        const sound = await NotificationSound.findOne({
            soundId: cleanSoundId,
            deletedAt: null,
        }).lean();

        if (!sound) {
            throw new Error(`Notification sound with soundId "${soundId}" not found.`);
        }

        return {
            enabled: sound.isActive,
            soundId: sound.soundId,
            name: sound.name,
            url: sound.fileUrl,
            durationMs: sound.durationMs || 0,
            platformSounds: sound.platformSounds || {},
        };
    }
}
