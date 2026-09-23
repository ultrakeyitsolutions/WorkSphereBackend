import { Types, Document } from 'mongoose';

export type ParticipantStatus = 'organizer' | 'accepted' | 'pending' | 'declined' | 'tentative';
export type MeetingType = 'video' | 'in_person' | 'phone' | 'sync';
export type MeetingProvider = 'none' | 'google_meet' | 'ms_teams';
export type OAuthProvider = 'google' | 'microsoft';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReminderMinutes = 0 | 5 | 10 | 15 | 30 | 60;

export interface ICalendarOrganizer {
    userId: Types.ObjectId;
    name: string;
    email: string;
    avatar?: string | null;
}

export interface ICalendarParticipant {
    userId: Types.ObjectId;
    name: string;
    email: string;
    avatar?: string | null;
    role?: string;
    designation?: string;
    status: ParticipantStatus;
    isCoOrganizer: boolean;
    respondedAt?: Date | null;
}

export interface IExternalProviderData {
    conferenceId?: string;
    joinWebUrl?: string;
    dialIn?: string;
}

export interface ICalendarEvent {
    companyId: Types.ObjectId;
    title: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    allDay: boolean;
    timeZone: string;
    organizer: ICalendarOrganizer;
    coOrganizers: Types.ObjectId[];
    participants: ICalendarParticipant[];
    meetingType: MeetingType;
    provider: MeetingProvider;
    meetingUrl?: string | null;
    externalEventId?: string | null;
    externalProviderData?: IExternalProviderData;
    agenda: string[];
    reminderMinutes: ReminderMinutes;
    recurrence: RecurrenceType;
    projectId?: Types.ObjectId | null;
    projectName?: string | null;
    taskId?: Types.ObjectId | null;
    taskName?: string | null;
    color?: string;
    isQuickMeeting?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICalendarEntitlements {
    providers: {
        google_meet: {
            enabled: boolean;
            featureKey: string;
        };
        ms_teams: {
            enabled: boolean;
            featureKey: string;
        };
    };
    quickMeetings: {
        enabled: boolean;
        monthlyLimit: number;
        isUnlimited: boolean;
        usedThisMonth: number;
        remainingThisMonth: number;
        billingCycle: string;
        planName: string;
    };
    googleMeetEnabled: boolean;
    msTeamsEnabled: boolean;
}

export interface ICalendarEventDocument extends ICalendarEvent, Document {}

export interface ICalendarOAuth {
    userId: Types.ObjectId;
    companyId: Types.ObjectId;
    provider: OAuthProvider;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    tokenExpiry?: Date;
    accountEmail?: string;
    scopes: string[];
    isConnected: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICalendarOAuthDocument extends ICalendarOAuth, Document {}

export interface ICreateCalendarEventPayload {
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    allDay?: boolean;
    timeZone?: string;
    participantIds?: string[];
    coOrganizers?: string[];
    meetingType?: MeetingType;
    provider?: MeetingProvider;
    agenda?: string[];
    reminderMinutes?: ReminderMinutes;
    recurrence?: RecurrenceType;
    projectId?: string;
    taskId?: string;
    color?: string;
}

export interface IUpdateCalendarEventPayload {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
    timeZone?: string;
    participantIds?: string[];
    coOrganizers?: string[];
    meetingType?: MeetingType;
    provider?: MeetingProvider;
    agenda?: string[];
    reminderMinutes?: ReminderMinutes;
    recurrence?: RecurrenceType;
    projectId?: string | null;
    taskId?: string | null;
    color?: string;
}

export interface IRescheduleEventPayload {
    startTime: string;
    endTime: string;
}

export interface IRsvpPayload {
    status: 'accepted' | 'declined' | 'tentative';
}

export interface IQuickMeetingPayload {
    title: string;
    provider?: MeetingProvider;
    durationMinutes?: number;
    projectId?: string;
    participantIds?: string[];
    description?: string;
}

export interface IConnectOAuthPayload {
    code: string;
    redirectUri: string;
}

export interface ICalendarEventFilterQuery {
    startDate?: string;
    endDate?: string;
    projectId?: string;
    provider?: string;
    status?: string;
    search?: string;
}
