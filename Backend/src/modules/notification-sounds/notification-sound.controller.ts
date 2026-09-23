import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { sendSuccess, sendError } from '../../utils/response';
import { NotificationSoundLibraryService } from './notification-sound-library.service';
import { NotificationSoundService } from './notification-sound.service';

/**
 * GET /api/superadmin/notification-sounds
 * Returns all notification sounds from the library.
 */
export const getSounds = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const sounds = await NotificationSoundLibraryService.getAllSounds(includeInactive);
        return sendSuccess(res, 'Notification sounds retrieved successfully', sounds);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to retrieve notification sounds', 500);
    }
};

/**
 * GET /api/superadmin/notification-sounds/default
 * Returns the default global notification sound.
 */
export const getDefaultSound = async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const defaultSound = await NotificationSoundLibraryService.getDefaultSound();
        if (!defaultSound) {
            return sendError(res, 'No default notification sound is configured.', 404);
        }
        return sendSuccess(res, 'Default notification sound retrieved successfully', defaultSound);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to retrieve default sound', 500);
    }
};

/**
 * PUT /api/superadmin/notification-sounds/default
 * Configures the default notification sound.
 */
export const setDefaultSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { soundId } = req.body;
        if (!soundId) {
            return sendError(res, 'soundId is required.', 400);
        }

        const userContext = req.user
            ? {
                userId: req.user.userId,
                role: req.user.role,
                email: req.user.email,
            }
            : undefined;

        const updated = await NotificationSoundLibraryService.setDefaultSound(soundId, userContext);
        return sendSuccess(res, `Default sound updated to "${updated.name}"`, updated);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update default sound', 400);
    }
};

/**
 * GET /api/superadmin/notification-sounds/mappings
 * Returns all notification event mappings.
 */
export const getMappings = async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const mappings = await NotificationSoundService.getAllMappings();
        return sendSuccess(res, 'Notification sound mappings retrieved successfully', mappings);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to retrieve sound mappings', 500);
    }
};

/**
 * GET /api/superadmin/notification-sounds/mappings/:notificationType
 * Returns configuration for a specific notification type.
 */
export const getMapping = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const notificationType = req.params.notificationType as string;
        if (!notificationType) {
            return sendError(res, 'notificationType is required.', 400);
        }

        const mapping = await NotificationSoundService.getMappingForType(notificationType);
        return sendSuccess(res, 'Mapping retrieved successfully', mapping);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to retrieve mapping', 404);
    }
};

/**
 * PUT /api/superadmin/notification-sounds/mappings/:notificationType
 * Updates configuration for a specific notification event.
 */
export const updateMapping = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const notificationType = req.params.notificationType as string;
        const { soundId, isEnabled } = req.body;

        const userContext = req.user
            ? {
                userId: req.user.userId,
                role: req.user.role,
                email: req.user.email,
            }
            : undefined;

        const updated = await NotificationSoundService.updateMapping(
            notificationType,
            { soundId: soundId ?? null, isEnabled: isEnabled !== undefined ? isEnabled : true },
            userContext
        );

        return sendSuccess(res, 'Notification sound mapping updated successfully', updated);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update mapping', 400);
    }
};

/**
 * POST /api/superadmin/notification-sounds/test
 * Tests a sound preview.
 */
export const testSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { soundId } = req.body;
        if (!soundId) {
            return sendError(res, 'soundId is required.', 400);
        }

        const metadata = await NotificationSoundService.testSound(soundId);
        return sendSuccess(res, 'Sound preview metadata retrieved successfully', metadata);
    } catch (err: any) {
        return sendError(res, err.message || 'Sound test failed', 404);
    }
};

/**
 * GET /api/superadmin/notification-sounds/:soundId
 * Returns a single sound by soundId.
 */
export const getSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const soundId = req.params.soundId as string;
        const includeInactive = req.query.includeInactive === 'true';
        const sound = await NotificationSoundLibraryService.getSoundById(soundId, includeInactive);

        if (!sound) {
            return sendError(res, `Notification sound with soundId "${soundId}" not found.`, 404);
        }

        return sendSuccess(res, 'Notification sound retrieved successfully', sound);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to retrieve notification sound', 500);
    }
};

/**
 * POST /api/superadmin/notification-sounds
 * Uploads a new notification sound to the library.
 */
export const uploadSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return sendError(res, 'Audio file is required (multipart field "file" or "audio").', 400);
        }

        const { soundId, name, description, durationMs, isActive, isDefault, platformSounds } = req.body;

        let parsedPlatformSounds;
        if (typeof platformSounds === 'string') {
            try {
                parsedPlatformSounds = JSON.parse(platformSounds);
            } catch {
                parsedPlatformSounds = undefined;
            }
        } else {
            parsedPlatformSounds = platformSounds;
        }

        const userContext = req.user
            ? {
                userId: req.user.userId,
                role: req.user.role,
                email: req.user.email,
            }
            : undefined;

        const newSound = await NotificationSoundLibraryService.uploadSound(
            file,
            {
                soundId,
                name,
                description,
                durationMs: durationMs ? Number(durationMs) : 0,
                isActive: isActive !== undefined ? String(isActive) === 'true' : true,
                isDefault: isDefault !== undefined ? String(isDefault) === 'true' : false,
                platformSounds: parsedPlatformSounds,
            },
            userContext
        );

        return sendSuccess(res, 'Notification sound uploaded successfully', newSound, 201);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to upload notification sound', 400);
    }
};

/**
 * PATCH /api/superadmin/notification-sounds/:soundId
 * Updates an existing sound in the library.
 */
export const updateSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const soundId = req.params.soundId as string;
        const file = req.file;
        const { name, description, isActive, isDefault, durationMs, platformSounds } = req.body;

        let parsedPlatformSounds;
        if (typeof platformSounds === 'string') {
            try {
                parsedPlatformSounds = JSON.parse(platformSounds);
            } catch {
                parsedPlatformSounds = undefined;
            }
        } else {
            parsedPlatformSounds = platformSounds;
        }

        const userContext = req.user
            ? {
                userId: req.user.userId,
                role: req.user.role,
                email: req.user.email,
            }
            : undefined;

        const updated = await NotificationSoundLibraryService.updateSound(
            soundId,
            {
                name,
                description,
                isActive: isActive !== undefined ? String(isActive) === 'true' : undefined,
                isDefault: isDefault !== undefined ? String(isDefault) === 'true' : undefined,
                durationMs: durationMs !== undefined ? Number(durationMs) : undefined,
                platformSounds: parsedPlatformSounds,
            },
            file,
            userContext
        );

        return sendSuccess(res, 'Notification sound updated successfully', updated);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update notification sound', 400);
    }
};

/**
 * DELETE /api/superadmin/notification-sounds/:soundId
 * Deletes a sound from the library (soft delete).
 */
export const deleteSound = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const soundId = req.params.soundId as string;

        const userContext = req.user
            ? {
                userId: req.user.userId,
                role: req.user.role,
                email: req.user.email,
            }
            : undefined;

        await NotificationSoundLibraryService.deleteSound(soundId, userContext);
        return sendSuccess(res, 'Notification sound deleted successfully', { soundId, deleted: true });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to delete notification sound', 400);
    }
};
