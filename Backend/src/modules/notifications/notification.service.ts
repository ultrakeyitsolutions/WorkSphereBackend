import mongoose, { Types } from 'mongoose';
import { NOTIFICATION_TYPES, NotificationEventPayload } from './notification.types';
import { NotificationRepository } from './notification.repository';
import { NotificationPreferenceService } from './notification-preference.service';
import { RecipientResolver } from './notification.recipient-resolver';
import { TemplateEngine } from './notification.template-engine';
import { SocketNotificationChannel } from './notification-socket.service';
import { INotification } from './notification.model';
import { NotificationSoundService } from '../notification-sounds/notification-sound.service';

// ─── Centralized Notification Service ──────────────────────────────────────
// The single entry point for processing and publishing notifications across WorkSphere.

export class NotificationService {
    private prefService = new NotificationPreferenceService();

    /**
     * Publishes a notification event.
     * Always safe to call (error isolated). Returns the list of created notifications.
     */
    public async publish(payload: NotificationEventPayload): Promise<INotification[]> {
        try {
            const { companyId, type, actorId, entityId, entityType, actionUrl, metadata, eventId } = payload;

            // 1. Validate Notification Type in Registry
            const typeDef = NOTIFICATION_TYPES[type];
            if (!typeDef) {
                console.warn(`[NotificationService] Unregistered notification type: ${type}`);
                return [];
            }

            // 2. Fetch Effective Company Preference
            const pref = await this.prefService.getEffectivePreference(companyId, type);

            // 3. Check if Enabled for this Company
            if (!pref.enabled) {
                return [];
            }

            // 4. Resolve Target Recipients
            const recipientIds = await RecipientResolver.resolveRecipients(payload);
            if (!recipientIds || recipientIds.length === 0) {
                return [];
            }

            // 5. Resolve Notification Sound Configuration (Global Super Admin setting)
            let soundMetadata = { enabled: false } as any;
            try {
                soundMetadata = await NotificationSoundService.resolveNotificationSound(type);
            } catch (soundErr) {
                console.warn(`[NotificationService] Failed to resolve sound for type ${type}:`, soundErr);
            }

            // 6. Resolve Actor Name and Project Name if missing in metadata
            let resolvedActorName = metadata?.actorName;
            if (!resolvedActorName && actorId && Types.ObjectId.isValid(actorId) && mongoose.connection.readyState === 1) {
                try {
                    const actorDoc = await mongoose.connection.collection('users').findOne(
                        { _id: new Types.ObjectId(actorId) },
                        { projection: { name: 1 } }
                    );
                    if (actorDoc?.name) {
                        resolvedActorName = actorDoc.name;
                    }
                } catch {
                    // Non-blocking fallback
                }
            }

            let resolvedProjectName = metadata?.projectName;
            if (!resolvedProjectName && payload.projectId && Types.ObjectId.isValid(payload.projectId) && mongoose.connection.readyState === 1) {
                try {
                    const projDoc = await mongoose.connection.collection('projects').findOne(
                        { _id: new Types.ObjectId(payload.projectId) },
                        { projection: { name: 1 } }
                    );
                    if (projDoc?.name) {
                        resolvedProjectName = projDoc.name;
                    }
                } catch {
                    // Non-blocking fallback
                }
            }

            // 7. Render Title and Message via Safe Template Engine
            const mergedContext = {
                ...typeDef.defaultMetadata,
                actorName: resolvedActorName || 'A team member',
                projectName: resolvedProjectName || 'the project',
                ...metadata,
                sound: soundMetadata,
            };

            const { title, message } = TemplateEngine.formatNotification(
                type,
                pref.titleTemplate,
                pref.messageTemplate,
                mergedContext
            );

            // 7. Filter Out Recipients that match Idempotency Key (eventId + recipientId)
            let targetRecipients = recipientIds;
            if (eventId) {
                const filtered: Types.ObjectId[] = [];
                for (const rid of recipientIds) {
                    const exists = await NotificationRepository.existsByIdempotency(eventId, rid);
                    if (!exists) {
                        filtered.push(rid);
                    }
                }
                targetRecipients = filtered;
            }

            if (targetRecipients.length === 0) {
                return [];
            }

            // 8. Calculate Expiration / Retention (Default 90 days)
            const retentionDays = metadata?.retentionDays || 90;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + retentionDays);

            // 9. Prepare Documents for Database Batch Insertion
            const companyObjId = new Types.ObjectId(companyId);
            const actorObjId = actorId ? new Types.ObjectId(actorId) : undefined;
            const entityObjId = entityId ? new Types.ObjectId(entityId) : undefined;
            const projectObjId = payload.projectId && Types.ObjectId.isValid(payload.projectId) ? new Types.ObjectId(payload.projectId) : undefined;
            const taskObjId = payload.taskId && Types.ObjectId.isValid(payload.taskId) ? new Types.ObjectId(payload.taskId) : undefined;
            const meetingObjId = payload.meetingId && Types.ObjectId.isValid(payload.meetingId) ? new Types.ObjectId(payload.meetingId) : undefined;
            const conversationObjId = payload.conversationId && Types.ObjectId.isValid(payload.conversationId) ? new Types.ObjectId(payload.conversationId) : undefined;

            // Generate fallback actionUrl if not provided
            let effectiveActionUrl = actionUrl;
            if (!effectiveActionUrl) {
                if (payload.taskId) {
                    effectiveActionUrl = payload.projectId
                        ? `/projects/${payload.projectId}/tasks/${payload.taskId}`
                        : `/tasks/${payload.taskId}`;
                } else if (payload.projectId) {
                    effectiveActionUrl = `/projects/${payload.projectId}`;
                } else if (payload.meetingId) {
                    effectiveActionUrl = `/companyadmin/quick-meetings?meetingId=${payload.meetingId}`;
                } else if (payload.conversationId) {
                    effectiveActionUrl = `/chat?conversationId=${payload.conversationId}`;
                }
            }

            const documentsToCreate: Array<Partial<INotification>> = targetRecipients.map((rid) => ({
                companyId: companyObjId,
                recipientId: rid,
                actorId: actorObjId,
                type,
                category: typeDef.category,
                title,
                message,
                style: (pref.style || typeDef.defaultStyle) as any,
                icon: typeDef.icon || typeDef.defaultIcon || 'bell',
                entityId: entityObjId,
                entityType,
                projectId: projectObjId,
                taskId: taskObjId,
                meetingId: meetingObjId,
                conversationId: conversationObjId,
                actionUrl: effectiveActionUrl,
                metadata: mergedContext,
                isRead: false,
                eventId,
                expiresAt,
            }));

            // 10. Persist Notifications in MongoDB
            const createdNotifications = await NotificationRepository.createMany(documentsToCreate);

            // 11. Channel Dispatches (In-App Socket, Push/Desktop, Email)
            for (const notif of createdNotifications) {
                const recipientIdStr = notif.recipientId.toString();

                // 11a. Real-Time Socket Channel (supports in-app bell & desktop browser notification popups)
                if (pref.channels.inApp || pref.channels.push) {
                    SocketNotificationChannel.deliverNotification(
                        recipientIdStr,
                        notif,
                        soundMetadata,
                        pref.channels
                    );

                    // Also push updated unread count
                    NotificationRepository.countUnread(recipientIdStr, companyId).then((unreadCount: number) => {
                        SocketNotificationChannel.deliverUnreadCount(recipientIdStr, unreadCount);
                    }).catch(() => { });
                }

                // 11b. Email Channel hook (extensible for nodemailer / SES)
                if (pref.channels.email) {
                    // Future: EmailNotificationChannel.send(...)
                }
            }

            return createdNotifications;
        } catch (err) {
            console.error('[NotificationService] Error publishing notification event:', err);
            return [];
        }
    }

    // ─── Query Delegates for API Controllers ───────────────────────────────

    public async getUserNotifications(recipientId: string, companyId: string, page: number, limit: number) {
        return NotificationRepository.findByRecipient(recipientId, companyId, page, limit);
    }

    public async getUnreadCount(recipientId: string, companyId: string): Promise<number> {
        return NotificationRepository.countUnread(recipientId, companyId);
    }

    public async markAsRead(notificationId: string, recipientId: string): Promise<INotification | null> {
        const notif = await NotificationRepository.markRead(notificationId, recipientId);
        if (notif) {
            const unreadCount = await NotificationRepository.countUnread(recipientId, notif.companyId.toString());
            SocketNotificationChannel.deliverUnreadCount(recipientId, unreadCount);
        }
        return notif;
    }

    public async markAllAsRead(recipientId: string, companyId: string): Promise<number> {
        const count = await NotificationRepository.markAllRead(recipientId, companyId);
        SocketNotificationChannel.deliverUnreadCount(recipientId, 0);
        return count;
    }

    public async deleteNotification(notificationId: string, recipientId: string): Promise<boolean> {
        return NotificationRepository.delete(notificationId, recipientId);
    }
}
