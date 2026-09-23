import crypto from 'crypto';
import { Types } from 'mongoose';
import { NotificationSound } from './notification-sound.model';
import { NotificationSoundMapping } from './notification-sound-mapping.model';
import {
    INotificationSound,
    CreateNotificationSoundDto,
    UpdateNotificationSoundDto,
} from './notification-sound.types';
import {
    ALLOWED_AUDIO_EXTENSIONS,
    ALLOWED_AUDIO_MIME_TYPES,
    NOTIFICATION_SOUND_MAX_SIZE_MB,
    DEFAULT_NOTIFICATION_SOUND_ID,
} from './notification-sound.constants';
import { StorageConfigurationService } from '../super-admin/storage/storage-config.service';
import { StorageProviderFactory } from '../../infrastructure/storage/storage-provider.factory';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationSoundService } from './notification-sound.service';

export class NotificationSoundLibraryService {
    /**
     * Get all sounds in the sound library.
     */
    static async getAllSounds(includeInactive = false): Promise<INotificationSound[]> {
        const query: Record<string, any> = { deletedAt: null };
        if (!includeInactive) {
            query.isActive = true;
        }
        return NotificationSound.find(query).sort({ isDefault: -1, name: 1 }).lean();
    }

    /**
     * Get a single sound by its unique soundId.
     */
    static async getSoundById(soundId: string, includeInactive = false): Promise<INotificationSound | null> {
        const query: Record<string, any> = {
            soundId: soundId.toLowerCase().trim(),
            deletedAt: null,
        };
        if (!includeInactive) {
            query.isActive = true;
        }
        return NotificationSound.findOne(query).lean();
    }

    /**
     * Validates audio file MIME type, extension, and file size.
     */
    static validateAudioFile(file: Express.Multer.File): void {
        if (!file || !file.buffer || file.size === 0) {
            throw new Error('Audio file is required and cannot be empty.');
        }

        const maxBytes = NOTIFICATION_SOUND_MAX_SIZE_MB * 1024 * 1024;
        if (file.size > maxBytes) {
            throw new Error(
                `Audio file size exceeds the maximum allowed limit of ${NOTIFICATION_SOUND_MAX_SIZE_MB}MB.`
            );
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
            throw new Error(
                `Unsupported audio file extension ".${ext}". Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(', ')}`
            );
        }

        const normalizedMime = file.mimetype.toLowerCase();
        const isMimeAllowed = ALLOWED_AUDIO_MIME_TYPES.includes(normalizedMime) || normalizedMime.startsWith('audio/');
        if (!isMimeAllowed) {
            throw new Error(
                `Unsupported audio MIME type "${file.mimetype}". Allowed types: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`
            );
        }
    }

    /**
     * Upload an audio file to storage provider.
     */
    private static async uploadToStorage(
        file: Express.Multer.File,
        soundId: string
    ): Promise<{ storageKey: string; fileUrl: string }> {
        const activeConfig = await StorageConfigurationService.getActiveConfiguration();
        const basePath = (activeConfig?.configuration?.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
        const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const storageKey = `${basePath}/system/notification-sounds/${soundId}/${uniquePrefix}-${sanitizedOriginal}`;

        const provider = StorageProviderFactory.createProvider(
            activeConfig?.provider || 'BUNNY',
            activeConfig?.configuration || {}
        );

        const uploadResult = await provider.uploadFile(file.buffer, storageKey, file.mimetype);
        return {
            storageKey: uploadResult.storageKey,
            fileUrl: uploadResult.storageUrl,
        };
    }

    /**
     * Upload and register a new notification sound in the sound library.
     */
    static async uploadSound(
        file: Express.Multer.File,
        dto: CreateNotificationSoundDto,
        userContext?: { userId: string; role?: string; email?: string }
    ): Promise<INotificationSound> {
        this.validateAudioFile(file);

        if (!dto.name || !dto.name.trim()) {
            throw new Error('Sound name is required.');
        }

        // Slugify soundId or derive from name
        let soundId = (dto.soundId || dto.name)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!soundId) {
            soundId = `sound-${Date.now()}`;
        }

        // Check if active or non-deleted soundId already exists
        const existing = await NotificationSound.findOne({ soundId, deletedAt: null });
        if (existing) {
            throw new Error(`A notification sound with soundId "${soundId}" already exists.`);
        }

        // Upload to active storage provider
        const { storageKey, fileUrl } = await this.uploadToStorage(file, soundId);

        // Handle default flag
        if (dto.isDefault) {
            await NotificationSound.updateMany({ isDefault: true }, { $set: { isDefault: false } });
        }

        const actorObjId = userContext?.userId ? new Types.ObjectId(userContext.userId) : undefined;

        const soundDoc = await NotificationSound.create({
            soundId,
            name: dto.name.trim(),
            description: dto.description?.trim() || '',
            fileUrl,
            storageKey,
            mimeType: file.mimetype,
            fileSize: file.size,
            durationMs: dto.durationMs || 0,
            isActive: dto.isActive !== undefined ? dto.isActive : true,
            isDefault: Boolean(dto.isDefault),
            platformSounds: dto.platformSounds || {},
            createdBy: actorObjId,
            updatedBy: actorObjId,
        });

        // Invalidate sound cache
        NotificationSoundService.invalidateCache();

        // Audit Log
        if (userContext?.userId) {
            await AuditLogService.log({
                action: AuditAction.NOTIFICATION_SOUND_CREATED,
                actorId: userContext.userId,
                actorEmail: userContext.email || null,
                actorRole: userContext.role || 'SUPER_ADMIN',
                targetUserId: null,
                companyId: null,
                metadata: {
                    soundId: soundDoc.soundId,
                    name: soundDoc.name,
                    fileUrl: soundDoc.fileUrl,
                    fileSize: soundDoc.fileSize,
                },
                success: true,
                description: `Created notification sound "${soundDoc.name}" (${soundDoc.soundId})`,
            });
        }

        return soundDoc;
    }

    /**
     * Update sound metadata or optionally replace audio file.
     */
    static async updateSound(
        soundId: string,
        updates: UpdateNotificationSoundDto,
        file?: Express.Multer.File,
        userContext?: { userId: string; role?: string; email?: string }
    ): Promise<INotificationSound> {
        const cleanSoundId = soundId.toLowerCase().trim();
        const sound = await NotificationSound.findOne({ soundId: cleanSoundId, deletedAt: null });

        if (!sound) {
            throw new Error(`Notification sound with soundId "${soundId}" not found.`);
        }

        // If replacing audio file
        if (file) {
            this.validateAudioFile(file);
            const { storageKey, fileUrl } = await this.uploadToStorage(file, cleanSoundId);
            sound.storageKey = storageKey;
            sound.fileUrl = fileUrl;
            sound.mimeType = file.mimetype;
            sound.fileSize = file.size;
        }

        if (updates.name !== undefined) sound.name = updates.name.trim();
        if (updates.description !== undefined) sound.description = updates.description.trim();
        if (updates.isActive !== undefined) sound.isActive = updates.isActive;
        if (updates.durationMs !== undefined) sound.durationMs = updates.durationMs;
        if (updates.platformSounds !== undefined) sound.platformSounds = updates.platformSounds;

        if (updates.isDefault === true) {
            await NotificationSound.updateMany({ _id: { $ne: sound._id }, isDefault: true }, { $set: { isDefault: false } });
            sound.isDefault = true;
        } else if (updates.isDefault === false) {
            sound.isDefault = false;
        }

        if (userContext?.userId) {
            sound.updatedBy = new Types.ObjectId(userContext.userId);
        }

        await sound.save();

        // Invalidate sound cache
        NotificationSoundService.invalidateCache();

        // Audit Log
        if (userContext?.userId) {
            await AuditLogService.log({
                action: AuditAction.NOTIFICATION_SOUND_UPDATED,
                actorId: userContext.userId,
                actorEmail: userContext.email || null,
                actorRole: userContext.role || 'SUPER_ADMIN',
                targetUserId: null,
                companyId: null,
                metadata: {
                    soundId: sound.soundId,
                    updates,
                    fileReplaced: Boolean(file),
                },
                success: true,
                description: `Updated notification sound "${sound.name}" (${sound.soundId})`,
            });
        }

        return sound;
    }

    /**
     * Soft delete a sound. Rejects if actively mapped to any notification event.
     */
    static async deleteSound(
        soundId: string,
        userContext?: { userId: string; role?: string; email?: string }
    ): Promise<boolean> {
        const cleanSoundId = soundId.toLowerCase().trim();
        const sound = await NotificationSound.findOne({ soundId: cleanSoundId, deletedAt: null });

        if (!sound) {
            throw new Error(`Notification sound with soundId "${soundId}" not found.`);
        }

        // Check if referenced by active mapping
        const activeMappings = await NotificationSoundMapping.find({
            soundId: cleanSoundId,
            isEnabled: true,
        }).lean();

        if (activeMappings.length > 0) {
            const mappedTypes = activeMappings.map((m) => m.notificationType).join(', ');
            throw new Error(
                `Cannot delete sound "${sound.name}" because it is currently assigned to active notification mapping(s): ${mappedTypes}. Please unassign or reassign them first.`
            );
        }

        sound.deletedAt = new Date();
        sound.isActive = false;
        sound.isDefault = false;
        if (userContext?.userId) {
            sound.updatedBy = new Types.ObjectId(userContext.userId);
        }
        await sound.save();

        // Invalidate sound cache
        NotificationSoundService.invalidateCache();

        // Audit Log
        if (userContext?.userId) {
            await AuditLogService.log({
                action: AuditAction.NOTIFICATION_SOUND_DELETED,
                actorId: userContext.userId,
                actorEmail: userContext.email || null,
                actorRole: userContext.role || 'SUPER_ADMIN',
                targetUserId: null,
                companyId: null,
                metadata: { soundId: sound.soundId, name: sound.name },
                success: true,
                description: `Deleted notification sound "${sound.name}" (${sound.soundId})`,
            });
        }

        return true;
    }

    /**
     * Get the default sound configured in the library.
     */
    static async getDefaultSound(): Promise<INotificationSound | null> {
        let defaultSound = await NotificationSound.findOne({
            isDefault: true,
            isActive: true,
            deletedAt: null,
        }).lean();

        if (!defaultSound) {
            defaultSound = await NotificationSound.findOne({
                soundId: DEFAULT_NOTIFICATION_SOUND_ID,
                isActive: true,
                deletedAt: null,
            }).lean();
        }

        if (!defaultSound) {
            defaultSound = await NotificationSound.findOne({
                isActive: true,
                deletedAt: null,
            }).sort({ createdAt: 1 }).lean();
        }

        return defaultSound;
    }

    /**
     * Set a sound as the global default notification sound.
     */
    static async setDefaultSound(
        soundId: string,
        userContext?: { userId: string; role?: string; email?: string }
    ): Promise<INotificationSound> {
        const cleanSoundId = soundId.toLowerCase().trim();
        const sound = await NotificationSound.findOne({
            soundId: cleanSoundId,
            deletedAt: null,
        });

        if (!sound) {
            throw new Error(`Notification sound with soundId "${soundId}" not found.`);
        }

        if (!sound.isActive) {
            throw new Error(`Cannot set inactive sound "${sound.name}" as default.`);
        }

        await NotificationSound.updateMany({ isDefault: true }, { $set: { isDefault: false } });

        sound.isDefault = true;
        if (userContext?.userId) {
            sound.updatedBy = new Types.ObjectId(userContext.userId);
        }
        await sound.save();

        // Invalidate cache
        NotificationSoundService.invalidateCache();

        // Audit Log
        if (userContext?.userId) {
            await AuditLogService.log({
                action: AuditAction.DEFAULT_NOTIFICATION_SOUND_CHANGED,
                actorId: userContext.userId,
                actorEmail: userContext.email || null,
                actorRole: userContext.role || 'SUPER_ADMIN',
                targetUserId: null,
                companyId: null,
                metadata: { soundId: sound.soundId, name: sound.name },
                success: true,
                description: `Set "${sound.name}" (${sound.soundId}) as default notification sound`,
            });
        }

        return sound;
    }
}
