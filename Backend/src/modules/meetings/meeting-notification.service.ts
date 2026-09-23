import { NotificationEventBus } from '../notifications/notification.event-bus';
import { NotificationType } from '../notifications/notification.types';

export interface MeetingNotificationParams {
    type: NotificationType;
    companyId: string;
    actorId: string;
    meetingId: string;
    recipientIds: string[];
    meetingTitle: string;
    projectName?: string;
    agenda?: string;
    scheduledStartAt?: Date | string;
    proposedStartAt?: Date | string;
    reason?: string;
    minutesUntilStart?: number;
    meetingLink?: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
}

export class MeetingNotificationService {
    /**
     * Dispatch domain notification event through the centralized event bus.
     */
    public static sendMeetingNotification(params: MeetingNotificationParams): void {
        const {
            type,
            companyId,
            actorId,
            meetingId,
            recipientIds,
            meetingTitle,
            projectName,
            agenda,
            scheduledStartAt,
            proposedStartAt,
            reason,
            minutesUntilStart,
            meetingLink,
            actionUrl,
            metadata = {},
        } = params;

        // Filter out empty recipient IDs
        const uniqueRecipients = Array.from(
            new Set((recipientIds || []).map((id) => (id ? id.toString() : '')).filter(Boolean))
        );

        if (uniqueRecipients.length === 0) {
            return;
        }

        const bus = NotificationEventBus.getInstance();

        bus.publish({
            type,
            companyId,
            actorId,
            entityId: meetingId,
            entityType: 'MEETING',
            meetingId,
            recipientIds: uniqueRecipients,
            actionUrl: actionUrl || `/companyadmin/quick-meetings?meetingId=${meetingId}`,
            metadata: {
                meetingName: meetingTitle,
                projectName: projectName || 'General',
                agenda: agenda || '',
                scheduledStartAt: scheduledStartAt
                    ? new Date(scheduledStartAt).toLocaleString()
                    : '',
                proposedStartAt: proposedStartAt
                    ? new Date(proposedStartAt).toLocaleString()
                    : '',
                reason: reason || '',
                minutesUntilStart: minutesUntilStart ?? 15,
                meetingLink: meetingLink || '',
                ...metadata,
            },
        });
    }
}
