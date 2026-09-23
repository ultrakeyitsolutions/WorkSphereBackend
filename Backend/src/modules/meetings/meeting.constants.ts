import { MeetingStatus } from './meeting.types';

// ─── Meeting State Machine Valid Transitions ──────────────────────────────────
export const ALLOWED_STATUS_TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
    [MeetingStatus.DRAFT]: [
        MeetingStatus.PENDING,
        MeetingStatus.ACCEPTED,
        MeetingStatus.CANCELLED,
    ],
    [MeetingStatus.PENDING]: [
        MeetingStatus.ACCEPTED,
        MeetingStatus.REJECTED,
        MeetingStatus.RESCHEDULE_REQUESTED,
        MeetingStatus.CANCELLED,
        MeetingStatus.EXPIRED,
    ],
    [MeetingStatus.ACCEPTED]: [
        MeetingStatus.RESCHEDULE_REQUESTED,
        MeetingStatus.CANCELLED,
        MeetingStatus.IN_PROGRESS,
        MeetingStatus.COMPLETED,
    ],
    [MeetingStatus.RESCHEDULE_REQUESTED]: [
        MeetingStatus.ACCEPTED,
        MeetingStatus.RESCHEDULED,
        MeetingStatus.REJECTED,
        MeetingStatus.CANCELLED,
    ],
    [MeetingStatus.RESCHEDULED]: [
        MeetingStatus.ACCEPTED,
        MeetingStatus.RESCHEDULE_REQUESTED,
        MeetingStatus.CANCELLED,
        MeetingStatus.IN_PROGRESS,
        MeetingStatus.COMPLETED,
    ],
    [MeetingStatus.IN_PROGRESS]: [
        MeetingStatus.COMPLETED,
        MeetingStatus.CANCELLED,
    ],
    [MeetingStatus.REJECTED]: [],
    [MeetingStatus.CANCELLED]: [],
    [MeetingStatus.COMPLETED]: [],
    [MeetingStatus.EXPIRED]: [],
};

// ─── Join Window Configuration ────────────────────────────────────────────────
export const MEETING_CONFIG = {
    // Window in minutes before scheduled start time that users can join
    EARLY_JOIN_MINUTES: 15,
    // Default duration if unspecified
    DEFAULT_DURATION_MINUTES: 30,
    // Availability calculation workday start and end hours (24h)
    WORKDAY_START_HOUR: 8,
    WORKDAY_END_HOUR: 19,
    // Availability slot step in minutes
    AVAILABILITY_SLOT_INTERVAL_MINUTES: 30,
    // Pagination defaults
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
};
