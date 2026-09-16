import { Types } from 'mongoose';
import { NotificationRepository } from './notification.repository';
import { NOTIFICATION_TYPES, NotificationType } from './notification.types';
import { INotificationPreference } from './notification-preference.model';
import { AuditLogService } from '../audit-logs/audit-log.service';

// ─── Notification Preference Service ────────────────────────────────────────
// Manages Company Admin configurations for notification types.

export class NotificationPreferenceService {
    /**
     * Synchronizes company preferences with the central NOTIFICATION_TYPES registry.
     * Missing notification types will have default preference documents created automatically.
     */
    public async syncCompanyPreferences(companyId: string | Types.ObjectId): Promise<void> {
        const existingPrefs = await NotificationRepository.getCompanyPreferences(companyId);
        const existingMap = new Map<string, INotificationPreference>(
            existingPrefs.map((p: INotificationPreference) => [p.notificationType, p])
        );

        const newPreferences: Array<Partial<INotificationPreference>> = [];

        for (const [typeKey, typeDef] of Object.entries(NOTIFICATION_TYPES)) {
            if (!existingMap.has(typeKey)) {
                newPreferences.push({
                    companyId: new Types.ObjectId(companyId),
                    notificationType: typeKey as NotificationType,
                    enabled: typeDef.defaultEnabled,
                    channels: typeDef.defaultChannels ?? { inApp: true, push: false, email: false },
                    style: (typeDef.defaultStyle || 'INFO') as any,
                    template: {
                        title: typeDef.defaultTitle,
                        message: typeDef.defaultMessage,
                    },
                });
            }
        }

        if (newPreferences.length > 0) {
            await NotificationRepository.bulkUpsertPreferences(companyId, newPreferences);
        }
    }

    /**
     * Gets all notification preferences for a company grouped by category.
     */
    public async getCompanyPreferences(companyId: string | Types.ObjectId) {
        // First sync missing preferences
        await this.syncCompanyPreferences(companyId);

        const prefs = await NotificationRepository.getCompanyPreferences(companyId);

        // Group by category
        const categorized: Record<string, any[]> = {};

        for (const pref of prefs) {
            const registryDef = NOTIFICATION_TYPES[pref.notificationType as NotificationType];
            const category = registryDef ? registryDef.category : 'SYSTEM';

            if (!categorized[category]) {
                categorized[category] = [];
            }

            categorized[category].push({
                type: pref.notificationType,
                name: registryDef?.name || pref.notificationType,
                description: registryDef?.description || '',
                enabled: pref.enabled,
                channels: pref.channels,
                style: pref.style || registryDef?.defaultStyle,
                template: {
                    title: pref.template?.title || registryDef?.defaultTitle,
                    message: pref.template?.message || registryDef?.defaultMessage,
                },
                allowedVariables: registryDef?.allowedVariables || [],
            });
        }

        return categorized;
    }

    /**
     * Updates a company's preference for a given notification type.
     */
    public async updatePreference(
        companyId: string | Types.ObjectId,
        notificationType: NotificationType,
        updates: {
            enabled?: boolean;
            channels?: { inApp?: boolean; push?: boolean; email?: boolean };
            style?: string;
            template?: { title?: string; message?: string };
        },
        adminUserId?: string
    ): Promise<INotificationPreference> {
        // Validate type exists in registry
        if (!NOTIFICATION_TYPES[notificationType]) {
            throw new Error(`Invalid notification type: ${notificationType}`);
        }

        const updatedPref = await NotificationRepository.upsertPreference(companyId, notificationType, updates);

        // Optional Audit Logging
        if (adminUserId) {
            try {
                await AuditLogService.log({
                    companyId: new Types.ObjectId(companyId),
                    userId: new Types.ObjectId(adminUserId),
                    action: 'NOTIFICATION_PREFERENCE_UPDATED',
                    module: 'NOTIFICATIONS',
                    details: `Updated notification preference for ${notificationType}`,
                    metadata: { notificationType, updates },
                } as any);
            } catch (err) {
                // Ignore audit log error if not strictly required
            }
        }

        return updatedPref;
    }

    /**
     * Retrieves the active preference for a notification type in a company.
     * Returns default settings if no custom preference exists.
     */
    public async getEffectivePreference(
        companyId: string | Types.ObjectId,
        type: NotificationType
    ): Promise<{
        enabled: boolean;
        channels: { inApp: boolean; push: boolean; email: boolean };
        titleTemplate: string;
        messageTemplate: string;
        style: string;
    }> {
        const typeDef = NOTIFICATION_TYPES[type];
        const pref = await NotificationRepository.getPreference(companyId, type);

        if (!pref) {
            return {
                enabled: typeDef ? typeDef.defaultEnabled : true,
                channels: typeDef?.defaultChannels ?? { inApp: true, push: false, email: false },
                titleTemplate: typeDef ? typeDef.defaultTitle : '',
                messageTemplate: typeDef ? typeDef.defaultMessage : '',
                style: typeDef ? typeDef.defaultStyle : 'INFO',
            };
        }

        return {
            enabled: pref.enabled,
            channels: pref.channels,
            titleTemplate: pref.template?.title || typeDef?.defaultTitle || '',
            messageTemplate: pref.template?.message || typeDef?.defaultMessage || '',
            style: pref.style || typeDef?.defaultStyle || 'INFO',
        };
    }
}
