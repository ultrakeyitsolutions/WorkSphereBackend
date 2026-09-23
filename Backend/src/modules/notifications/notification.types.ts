// ─── Notification Types Registry ────────────────────────────────────────────
// This is the SINGLE source of truth for all notification types in WorkSphere.
// Adding a new type here automatically propagates it to:
//   - GET /api/v1/notifications/types (frontend auto-discovers)
//   - Company preference defaults (created on sync)
//   - Admin Preferences UI (rendered dynamically)

export type NotificationStyle = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'SYSTEM';
export type NotificationCategory = 'PROJECT' | 'TASK' | 'MEETING' | 'CHAT' | 'ATTENDANCE' | 'TRACKING' | 'SYSTEM';
export type NotificationChannel = 'inApp' | 'push' | 'email';

export interface NotificationTypeDefinition {
    name?: string;
    description?: string;
    category: NotificationCategory;
    defaultTitle: string;
    defaultMessage: string;
    defaultStyle: NotificationStyle;
    icon: string;
    defaultIcon?: string;
    defaultChannels?: { inApp: boolean; push: boolean; email: boolean };
    defaultMetadata?: Record<string, any>;
    allowedVariables: string[];
    defaultEnabled: boolean;
}

export const NOTIFICATION_TYPES: Record<string, NotificationTypeDefinition> = {
    // ── PROJECT ───────────────────────────────────────────────────────────────
    PROJECT_CREATED: {
        category: 'PROJECT',
        defaultTitle: 'New Project Created',
        defaultMessage: '{{actorName}} created a new project {{projectName}}',
        defaultStyle: 'INFO',
        icon: 'folder-plus',
        allowedVariables: ['actorName', 'recipientName', 'companyName', 'projectName'],
        defaultEnabled: true,
    },
    PROJECT_UPDATED: {
        category: 'PROJECT',
        defaultTitle: 'Project Updated',
        defaultMessage: '{{actorName}} updated {{projectName}}',
        defaultStyle: 'INFO',
        icon: 'folder-edit',
        allowedVariables: ['actorName', 'recipientName', 'companyName', 'projectName'],
        defaultEnabled: true,
    },
    PROJECT_STATUS_CHANGED: {
        category: 'PROJECT',
        defaultTitle: 'Project Status Changed',
        defaultMessage: '{{actorName}} changed {{projectName}} status to {{status}}',
        defaultStyle: 'INFO',
        icon: 'refresh-cw',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'status'],
        defaultEnabled: true,
    },
    PROJECT_MEMBER_ADDED: {
        category: 'PROJECT',
        defaultTitle: 'Added to Project',
        defaultMessage: '{{actorName}} added you to {{projectName}}',
        defaultStyle: 'INFO',
        icon: 'user-plus',
        allowedVariables: ['actorName', 'recipientName', 'projectName'],
        defaultEnabled: true,
    },
    PROJECT_MEMBER_REMOVED: {
        category: 'PROJECT',
        defaultTitle: 'Removed from Project',
        defaultMessage: '{{actorName}} removed you from {{projectName}}',
        defaultStyle: 'WARNING',
        icon: 'user-minus',
        allowedVariables: ['actorName', 'recipientName', 'projectName'],
        defaultEnabled: true,
    },

    // ── TASK ──────────────────────────────────────────────────────────────────
    TASK_CREATED: {
        category: 'TASK',
        defaultTitle: 'New Task Assigned',
        defaultMessage: '{{actorName}} assigned you {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'list-plus',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName', 'dueDate', 'status'],
        defaultEnabled: true,
    },
    TASK_UPDATED: {
        category: 'TASK',
        defaultTitle: 'Task Updated',
        defaultMessage: '{{actorName}} updated {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'edit',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_STARTED: {
        category: 'TASK',
        defaultTitle: 'Task Started',
        defaultMessage: '{{actorName}} started {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'play',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_PAUSED: {
        category: 'TASK',
        defaultTitle: 'Task Paused',
        defaultMessage: '{{actorName}} paused {{taskName}}',
        defaultStyle: 'WARNING',
        icon: 'pause',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_RESUMED: {
        category: 'TASK',
        defaultTitle: 'Task Resumed',
        defaultMessage: '{{actorName}} resumed {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'play-circle',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_HOLD: {
        category: 'TASK',
        defaultTitle: 'Task On Hold',
        defaultMessage: '{{actorName}} placed {{taskName}} on hold',
        defaultStyle: 'WARNING',
        icon: 'clock',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_COMPLETED: {
        category: 'TASK',
        defaultTitle: 'Task Completed',
        defaultMessage: '{{actorName}} completed {{taskName}}',
        defaultStyle: 'SUCCESS',
        icon: 'check-circle',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_DOCUMENT_UPLOADED: {
        category: 'TASK',
        defaultTitle: 'Document Uploaded',
        defaultMessage: '{{actorName}} uploaded a document to {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'file',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TASK_AUDIO_UPLOADED: {
        category: 'TASK',
        defaultTitle: 'Audio Uploaded',
        defaultMessage: '{{actorName}} uploaded an audio file to {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'mic',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: false,
    },
    TASK_CHECKLIST_UPDATED: {
        category: 'TASK',
        defaultTitle: 'Checklist Updated',
        defaultMessage: '{{actorName}} updated the checklist on {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'check-square',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },

    // ── TASK TRACKING ─────────────────────────────────────────────────────────
    TRACKING_STARTED: {
        category: 'TRACKING',
        defaultTitle: 'Tracking Started',
        defaultMessage: '{{actorName}} started tracking {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'timer',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TRACKING_PAUSED: {
        category: 'TRACKING',
        defaultTitle: 'Tracking Paused',
        defaultMessage: '{{actorName}} paused tracking on {{taskName}}',
        defaultStyle: 'WARNING',
        icon: 'pause-circle',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TRACKING_RESUMED: {
        category: 'TRACKING',
        defaultTitle: 'Tracking Resumed',
        defaultMessage: '{{actorName}} resumed tracking on {{taskName}}',
        defaultStyle: 'INFO',
        icon: 'play-circle',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TRACKING_HELD: {
        category: 'TRACKING',
        defaultTitle: 'Tracking On Hold',
        defaultMessage: '{{actorName}} placed tracking for {{taskName}} on hold',
        defaultStyle: 'WARNING',
        icon: 'clock',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },
    TRACKING_COMPLETED: {
        category: 'TRACKING',
        defaultTitle: 'Tracking Completed',
        defaultMessage: '{{actorName}} completed tracking on {{taskName}}',
        defaultStyle: 'SUCCESS',
        icon: 'check-circle',
        allowedVariables: ['actorName', 'recipientName', 'projectName', 'taskName'],
        defaultEnabled: true,
    },

    // ── MEETING ───────────────────────────────────────────────────────────────
    MEETING_CREATED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Scheduled',
        defaultMessage: '{{actorName}} scheduled a meeting: {{meetingName}}',
        defaultStyle: 'INFO',
        icon: 'calendar-plus',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'projectName'],
        defaultEnabled: true,
    },
    MEETING_REQUESTED: {
        category: 'MEETING',
        defaultTitle: 'New Meeting Request',
        defaultMessage: '{{actorName}} requested a meeting with you: {{meetingName}}',
        defaultStyle: 'INFO',
        icon: 'calendar-plus',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'projectName', 'agenda', 'scheduledStartAt'],
        defaultEnabled: true,
    },
    MEETING_ACCEPTED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Confirmed',
        defaultMessage: '{{actorName}} accepted the meeting request: {{meetingName}}',
        defaultStyle: 'SUCCESS',
        icon: 'check-circle',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'projectName', 'scheduledStartAt'],
        defaultEnabled: true,
    },
    MEETING_REJECTED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Declined',
        defaultMessage: '{{actorName}} declined the meeting request: {{meetingName}}',
        defaultStyle: 'WARNING',
        icon: 'x-circle',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'reason'],
        defaultEnabled: true,
    },
    MEETING_RESCHEDULE_REQUESTED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Reschedule Requested',
        defaultMessage: '{{actorName}} proposed a new time for {{meetingName}}',
        defaultStyle: 'WARNING',
        icon: 'clock',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'proposedStartAt', 'reason'],
        defaultEnabled: true,
    },
    MEETING_RESCHEDULE_ACCEPTED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Rescheduled',
        defaultMessage: 'The new schedule for {{meetingName}} has been confirmed',
        defaultStyle: 'SUCCESS',
        icon: 'calendar-check',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'scheduledStartAt'],
        defaultEnabled: true,
    },
    MEETING_RESCHEDULE_REJECTED: {
        category: 'MEETING',
        defaultTitle: 'Reschedule Proposal Rejected',
        defaultMessage: '{{actorName}} rejected the proposed time change for {{meetingName}}',
        defaultStyle: 'WARNING',
        icon: 'calendar-x',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'reason'],
        defaultEnabled: true,
    },
    MEETING_UPDATED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Updated',
        defaultMessage: 'Meeting details for {{meetingName}} were updated',
        defaultStyle: 'INFO',
        icon: 'calendar',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'projectName'],
        defaultEnabled: true,
    },
    MEETING_CANCELLED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Cancelled',
        defaultMessage: '{{actorName}} cancelled the meeting: {{meetingName}}',
        defaultStyle: 'ERROR',
        icon: 'calendar-x',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'reason'],
        defaultEnabled: true,
    },
    MEETING_STARTING_SOON: {
        category: 'MEETING',
        defaultTitle: 'Meeting Starting Soon',
        defaultMessage: 'Your meeting {{meetingName}} starts in {{minutesUntilStart}} minutes',
        defaultStyle: 'INFO',
        icon: 'bell',
        allowedVariables: ['recipientName', 'meetingName', 'minutesUntilStart', 'meetingLink'],
        defaultEnabled: true,
    },
    MEETING_STARTED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Started',
        defaultMessage: 'The meeting {{meetingName}} has started',
        defaultStyle: 'INFO',
        icon: 'video',
        allowedVariables: ['actorName', 'recipientName', 'meetingName', 'meetingLink'],
        defaultEnabled: true,
    },
    MEETING_COMPLETED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Completed',
        defaultMessage: 'The meeting {{meetingName}} has ended',
        defaultStyle: 'INFO',
        icon: 'check-circle',
        allowedVariables: ['actorName', 'recipientName', 'meetingName'],
        defaultEnabled: true,
    },
    MEETING_ENDED: {
        category: 'MEETING',
        defaultTitle: 'Meeting Ended',
        defaultMessage: 'The meeting {{meetingName}} has ended',
        defaultStyle: 'INFO',
        icon: 'video-off',
        allowedVariables: ['actorName', 'recipientName', 'meetingName'],
        defaultEnabled: true,
    },
    MEETING_PARTICIPANT_ADDED: {
        category: 'MEETING',
        defaultTitle: 'Added to Meeting',
        defaultMessage: '{{actorName}} added you to the meeting {{meetingName}}',
        defaultStyle: 'INFO',
        icon: 'user-check',
        allowedVariables: ['actorName', 'recipientName', 'meetingName'],
        defaultEnabled: true,
    },

    // ── CHAT ──────────────────────────────────────────────────────────────────
    CHAT_MESSAGE: {
        category: 'CHAT',
        defaultTitle: 'New Message',
        defaultMessage: '{{actorName}} sent you a message',
        defaultStyle: 'INFO',
        icon: 'message-circle',
        allowedVariables: ['actorName', 'recipientName', 'message'],
        defaultEnabled: true,
    },
    CHAT_MENTION: {
        category: 'CHAT',
        defaultTitle: 'You Were Mentioned',
        defaultMessage: '{{actorName}} mentioned you in a message',
        defaultStyle: 'INFO',
        icon: 'at-sign',
        allowedVariables: ['actorName', 'recipientName', 'message'],
        defaultEnabled: true,
    },

    // ── ATTENDANCE ────────────────────────────────────────────────────────────
    CHECK_IN: {
        category: 'ATTENDANCE',
        defaultTitle: 'Check In',
        defaultMessage: '{{actorName}} checked in',
        defaultStyle: 'SUCCESS',
        icon: 'log-in',
        allowedVariables: ['actorName', 'recipientName', 'companyName'],
        defaultEnabled: true,
    },
    CHECK_OUT: {
        category: 'ATTENDANCE',
        defaultTitle: 'Check Out',
        defaultMessage: '{{actorName}} checked out',
        defaultStyle: 'INFO',
        icon: 'log-out',
        allowedVariables: ['actorName', 'recipientName', 'companyName'],
        defaultEnabled: true,
    },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** All registered notification type keys */
export const ALL_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** Check whether a string is a valid registered notification type */
export function isValidNotificationType(type: string): type is NotificationType {
    return type in NOTIFICATION_TYPES;
}

/** Payload published by any business module to the event bus */
export interface NotificationEventPayload {
    type: NotificationType;
    companyId: string;
    actorId: string;
    /** Optional idempotency key — prevents duplicate notifications on retries */
    eventId?: string;
    entityId?: string;
    entityType?: string;
    projectId?: string;
    taskId?: string;
    meetingId?: string;
    conversationId?: string;
    /** Extra context used by recipient resolver and template engine */
    metadata?: Record<string, any>;
    /** Explicit recipient IDs — only used for MENTION-type events where backend knows targets */
    explicitRecipientIds?: string[];
    recipientIds?: string[];
    actionUrl?: string;
}
