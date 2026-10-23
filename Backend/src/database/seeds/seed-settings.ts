import { StorageConfiguration } from '../../modules/super-admin/storage/storage-config.model';
import { NotificationSound } from '../../modules/notification-sounds/notification-sound.model';
import { DEFAULT_NOTIFICATION_SOUND_ID } from '../../modules/notification-sounds/notification-sound.constants';
import { Company } from '../../modules/super-admin/companies/company.model';
import {
    CompanySettings,
    DEFAULT_GENERAL_SETTINGS,
    DEFAULT_FEATURE_FLAGS,
    DEFAULT_ATTENDANCE_POLICIES,
    DEFAULT_SECURITY_POLICIES,
} from '../../modules/companyadmin/settings/company-settings.model';
import { SUPPORTED_MODULES } from '../../modules/companyadmin/module-access/module-access.constants';
import { env } from '../../config/env';

export interface SettingsSeedResult {
    storageInitialized: boolean;
    defaultSoundInitialized: boolean;
    companySettingsBackfilled: number;
    supportedModulesCount: number;
}

/**
 * Idempotently seeds default system settings and backfills settings for any existing companies.
 *
 * PRODUCTION SAFETY GUARANTEES:
 * 1. Never overwrites existing custom storage credentials or CDN configuration.
 * 2. Never overwrites existing company settings or custom themes.
 * 3. Never creates transactional test companies or employees.
 */
export async function seedSettings(dryRun = false): Promise<SettingsSeedResult> {
    let storageInitialized = false;
    let defaultSoundInitialized = false;
    let companySettingsBackfilled = 0;

    // ── 1. Storage Configuration ──────────────────────────────────────────────
    const existingStorage = await StorageConfiguration.findOne({});
    if (!existingStorage) {
        if (!dryRun) {
            await StorageConfiguration.create({
                provider: 'BUNNY',
                enabled: Boolean(env.BUNNY_STORAGE_ZONE && env.BUNNY_STORAGE_ACCESS_KEY),
                configuration: {
                    storageZone: env.BUNNY_STORAGE_ZONE || 'worksphere',
                    accessKey: env.BUNNY_STORAGE_ACCESS_KEY || '',
                    region: env.BUNNY_STORAGE_REGION || '',
                    pullZoneUrl: env.BUNNY_PULL_ZONE_URL || '',
                    basePath: env.BUNNY_STORAGE_BASE_PATH || 'worksphere',
                },
                limits: {
                    imageMaxSizeMB: 15,
                    documentMaxSizeMB: 30,
                    audioMaxSizeMB: 30,
                    videoMaxSizeMB: 100,
                },
                allowedTypes: {
                    image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
                    document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt'],
                    audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
                    video: ['mp4', 'mov', 'webm'],
                },
            });
        }
        storageInitialized = true;
    }

    // ── 2. Default Notification Sound ─────────────────────────────────────────
    const existingDefaultSound = await NotificationSound.findOne({
        isDefault: true,
        deletedAt: null,
    });

    if (!existingDefaultSound) {
        const soundById = await NotificationSound.findOne({
            soundId: DEFAULT_NOTIFICATION_SOUND_ID,
            deletedAt: null,
        });

        if (!soundById) {
            if (!dryRun) {
                await NotificationSound.create({
                    soundId: DEFAULT_NOTIFICATION_SOUND_ID,
                    name: 'Default Chime',
                    description: 'System standard notification alert sound',
                    storageKey: 'defaults/sounds/default-bell.mp3',
                    fileUrl: '/defaults/sounds/default-bell.mp3',
                    mimeType: 'audio/mp3',
                    fileSize: 15420,
                    durationMs: 1200,
                    isDefault: true,
                    isActive: true,
                });
            }
            defaultSoundInitialized = true;
        } else if (!soundById.isDefault) {
            if (!dryRun) {
                soundById.isDefault = true;
                await soundById.save();
            }
            defaultSoundInitialized = true;
        }
    }

    // ── 3. Backfill Existing Company Settings (if any company exists in DB) ────
    const existingCompanies = await Company.find({}).lean();
    for (const company of existingCompanies) {
        const settings = await CompanySettings.findOne({ companyId: company._id });
        if (!settings) {
            if (!dryRun) {
                await CompanySettings.create({
                    companyId: company._id,
                    general: {
                        timezone: (company as any).timezone || DEFAULT_GENERAL_SETTINGS.timezone,
                        currency: (company as any).currency || DEFAULT_GENERAL_SETTINGS.currency,
                        dateFormat: DEFAULT_GENERAL_SETTINGS.dateFormat,
                        language: DEFAULT_GENERAL_SETTINGS.language,
                    },
                    features: { ...DEFAULT_FEATURE_FLAGS },
                    attendancePolicies: { ...DEFAULT_ATTENDANCE_POLICIES },
                    securityPolicies: { ...DEFAULT_SECURITY_POLICIES },
                    schemaVersion: 1,
                });
            }
            companySettingsBackfilled++;
        }
    }

    return {
        storageInitialized,
        defaultSoundInitialized,
        companySettingsBackfilled,
        supportedModulesCount: SUPPORTED_MODULES.length,
    };
}
