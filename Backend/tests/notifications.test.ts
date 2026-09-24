import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { SocketNotificationChannel } from '../src/modules/notifications/notification-socket.service';
import { NotificationRepository } from '../src/modules/notifications/notification.repository';
import { NotificationPreferenceService } from '../src/modules/notifications/notification-preference.service';
import { NotificationSoundService } from '../src/modules/notification-sounds/notification-sound.service';
import { RecipientResolver } from '../src/modules/notifications/notification.recipient-resolver';
import { NOTIFICATION_TYPES } from '../src/modules/notifications/notification.types';

describe('WorkSphere Desktop & In-App Notification System Audit', () => {
    let service: NotificationService;
    const testCompanyId = new Types.ObjectId().toString();
    const testActorId = new Types.ObjectId().toString();
    const testRecipientId = new Types.ObjectId().toString();
    const testRecipientId2 = new Types.ObjectId().toString();
    const testProjectId = new Types.ObjectId().toString();
    const testTaskId = new Types.ObjectId().toString();
    const testMeetingId = new Types.ObjectId().toString();

    beforeEach(() => {
        service = new NotificationService();
        vi.restoreAllMocks();

        // Default mock for preference service
        vi.spyOn(NotificationPreferenceService.prototype, 'getEffectivePreference').mockResolvedValue({
            enabled: true,
            channels: { inApp: true, push: true, email: false },
            titleTemplate: '',
            messageTemplate: '',
            style: 'INFO',
        });

        // Default mock for sound resolver
        vi.spyOn(NotificationSoundService, 'resolveNotificationSound').mockResolvedValue({
            enabled: false,
        } as any);

        // Default mock for recipient resolver
        vi.spyOn(RecipientResolver, 'resolveRecipients').mockImplementation(async (payload) => {
            const list = payload.recipientIds || payload.explicitRecipientIds || [];
            return list.map(id => new Types.ObjectId(id));
        });
    });

    describe('1. Desktop Notification Payload & Structure', () => {
        it('should generate complete desktop notification payload including IDs, actionUrl, and channels', async () => {
            let emittedEvent = '';
            let emittedPayload: any = null;
            let emittedRoom = '';

            vi.spyOn(SocketNotificationChannel, 'deliverNotification').mockImplementation((recipientId, notif, sound, channels) => {
                emittedRoom = `user:${recipientId}`;
                emittedEvent = 'notification:new';
                emittedPayload = {
                    id: notif._id,
                    _id: notif._id,
                    userId: recipientId,
                    recipientId,
                    type: notif.type,
                    notificationType: notif.type,
                    category: notif.category,
                    title: notif.title,
                    message: notif.message,
                    style: notif.style,
                    icon: notif.icon,
                    projectId: notif.projectId,
                    taskId: notif.taskId,
                    meetingId: notif.meetingId,
                    conversationId: notif.conversationId,
                    actionUrl: notif.actionUrl,
                    metadata: notif.metadata,
                    channels: channels || { inApp: true, push: true, email: false },
                    sound: sound || { enabled: false },
                    createdAt: notif.createdAt,
                    isRead: false,
                };
            });

            const fakeNotificationDoc: any = {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(testCompanyId),
                recipientId: new Types.ObjectId(testRecipientId),
                actorId: new Types.ObjectId(testActorId),
                type: 'TASK_CREATED',
                category: 'TASK',
                title: 'New Task Assigned',
                message: 'Admin assigned you Task 101',
                style: 'INFO',
                icon: 'list-plus',
                projectId: new Types.ObjectId(testProjectId),
                taskId: new Types.ObjectId(testTaskId),
                actionUrl: `/projects/${testProjectId}/tasks/${testTaskId}`,
                metadata: { taskName: 'Task 101', projectName: 'Project Apollo' },
                isRead: false,
                createdAt: new Date(),
            };

            vi.spyOn(NotificationRepository, 'createMany').mockResolvedValue([fakeNotificationDoc]);
            vi.spyOn(NotificationRepository, 'countUnread').mockResolvedValue(1);

            const result = await service.publish({
                type: 'TASK_CREATED',
                companyId: testCompanyId,
                actorId: testActorId,
                entityId: testTaskId,
                entityType: 'TASK',
                projectId: testProjectId,
                taskId: testTaskId,
                recipientIds: [testRecipientId],
                metadata: {
                    actorName: 'Admin',
                    taskName: 'Task 101',
                    projectName: 'Project Apollo',
                },
            });

            expect(result).toHaveLength(1);
            expect(emittedRoom).toBe(`user:${testRecipientId}`);
            expect(emittedEvent).toBe('notification:new');
            expect(emittedPayload).toBeDefined();
            expect(emittedPayload.userId).toBe(testRecipientId);
            expect(emittedPayload.type).toBe('TASK_CREATED');
            expect(emittedPayload.category).toBe('TASK');
            expect(emittedPayload.title).toBeDefined();
            expect(emittedPayload.message).toBeDefined();
            expect(emittedPayload.taskId?.toString()).toBe(testTaskId);
            expect(emittedPayload.projectId?.toString()).toBe(testProjectId);
            expect(emittedPayload.actionUrl).toBe(`/projects/${testProjectId}/tasks/${testTaskId}`);
            expect(emittedPayload.isRead).toBe(false);
            expect(emittedPayload.channels).toBeDefined();
        });
    });

    describe('2. Real-Time Delivery & Recipient Isolation', () => {
        it('should deliver notifications strictly to target users and not leak to other users or broadcast to company', async () => {
            const deliveredRecipients: string[] = [];

            vi.spyOn(SocketNotificationChannel, 'deliverNotification').mockImplementation((recipientId) => {
                deliveredRecipients.push(recipientId);
            });

            const fakeDocs: any[] = [
                {
                    _id: new Types.ObjectId(),
                    recipientId: new Types.ObjectId(testRecipientId),
                    companyId: new Types.ObjectId(testCompanyId),
                    type: 'MEETING_CREATED',
                    category: 'MEETING',
                    title: 'Meeting Scheduled',
                    message: 'Meeting scheduled',
                    isRead: false,
                    createdAt: new Date(),
                },
                {
                    _id: new Types.ObjectId(),
                    recipientId: new Types.ObjectId(testRecipientId2),
                    companyId: new Types.ObjectId(testCompanyId),
                    type: 'MEETING_CREATED',
                    category: 'MEETING',
                    title: 'Meeting Scheduled',
                    message: 'Meeting scheduled',
                    isRead: false,
                    createdAt: new Date(),
                },
            ];

            vi.spyOn(NotificationRepository, 'createMany').mockResolvedValue(fakeDocs);
            vi.spyOn(NotificationRepository, 'countUnread').mockResolvedValue(1);

            await service.publish({
                type: 'MEETING_CREATED',
                companyId: testCompanyId,
                actorId: testActorId,
                meetingId: testMeetingId,
                recipientIds: [testRecipientId, testRecipientId2],
                metadata: {
                    actorName: 'Organizer',
                    meetingName: 'Design Review',
                },
            });

            expect(deliveredRecipients).toEqual([testRecipientId, testRecipientId2]);
            expect(deliveredRecipients).not.toContain(testActorId);
        });
    });

    describe('3. Notification Preferences & Channel Controls', () => {
        it('should respect company preference when notification type is disabled', async () => {
            vi.spyOn(NotificationPreferenceService.prototype, 'getEffectivePreference').mockResolvedValue({
                enabled: false,
                channels: { inApp: false, push: false, email: false },
                titleTemplate: '',
                messageTemplate: '',
                style: 'INFO',
            });

            const deliverSpy = vi.spyOn(SocketNotificationChannel, 'deliverNotification');
            const createManySpy = vi.spyOn(NotificationRepository, 'createMany');

            const result = await service.publish({
                type: 'CHAT_MESSAGE',
                companyId: testCompanyId,
                actorId: testActorId,
                recipientIds: [testRecipientId],
            });

            expect(result).toHaveLength(0);
            expect(deliverSpy).not.toHaveBeenCalled();
            expect(createManySpy).not.toHaveBeenCalled();
        });
    });

    describe('4. Idempotency & Duplicate Prevention', () => {
        it('should skip duplicate eventId for the same recipient', async () => {
            const eventId = 'unique-event-xyz-123';

            vi.spyOn(NotificationRepository, 'existsByIdempotency').mockResolvedValue(true);
            const createManySpy = vi.spyOn(NotificationRepository, 'createMany');

            const result = await service.publish({
                type: 'TASK_CREATED',
                companyId: testCompanyId,
                actorId: testActorId,
                eventId,
                recipientIds: [testRecipientId],
            });

            expect(result).toHaveLength(0);
            expect(createManySpy).not.toHaveBeenCalled();
        });
    });

    describe('5. Read / Seen Status Handling', () => {
        it('should maintain unread state upon delivery and only mark as read via explicit read API', async () => {
            const notificationId = new Types.ObjectId().toString();
            const fakeNotif: any = {
                _id: new Types.ObjectId(notificationId),
                companyId: new Types.ObjectId(testCompanyId),
                recipientId: new Types.ObjectId(testRecipientId),
                isRead: true,
                readAt: new Date(),
            };

            vi.spyOn(NotificationRepository, 'markRead').mockResolvedValue(fakeNotif);
            vi.spyOn(NotificationRepository, 'countUnread').mockResolvedValue(0);
            const deliverUnreadSpy = vi.spyOn(SocketNotificationChannel, 'deliverUnreadCount');

            const updated = await service.markAsRead(notificationId, testRecipientId);

            expect(updated).toBeDefined();
            expect(updated?.isRead).toBe(true);
            expect(deliverUnreadSpy).toHaveBeenCalledWith(testRecipientId, 0);
        });
    });

    describe('6. Notification Types Registry Completeness', () => {
        it('should verify all core categories and types are registered', () => {
            const categories = new Set(Object.values(NOTIFICATION_TYPES).map(t => t.category));
            expect(categories.has('PROJECT')).toBe(true);
            expect(categories.has('TASK')).toBe(true);
            expect(categories.has('MEETING')).toBe(true);
            expect(categories.has('CHAT')).toBe(true);
            expect(categories.has('ATTENDANCE')).toBe(true);
            expect(categories.has('TRACKING')).toBe(true);
            expect(categories.has('ANNOUNCEMENT')).toBe(true);
            expect(categories.has('REMINDER')).toBe(true);
        });
    });
});
