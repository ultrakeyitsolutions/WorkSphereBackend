import { Document, Types } from 'mongoose';

// ─── Meeting Status Lifecycle ─────────────────────────────────────────────────
export enum MeetingStatus {
    DRAFT = 'DRAFT',
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
    RESCHEDULED = 'RESCHEDULED',
    CANCELLED = 'CANCELLED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    EXPIRED = 'EXPIRED',
}

// ─── Participant Roles & Statuses ─────────────────────────────────────────────
export enum ParticipantRole {
    ORGANIZER = 'ORGANIZER',
    REQUIRED = 'REQUIRED',
    OPTIONAL = 'OPTIONAL',
}

export enum ParticipantResponseStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    DECLINED = 'DECLINED',
    RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
}

export enum MeetingType {
    QUICK = 'QUICK',
    SCHEDULED = 'SCHEDULED',
    PROJECT_REVIEW = 'PROJECT_REVIEW',
    ONE_ON_ONE = 'ONE_ON_ONE',
    SYNC = 'SYNC',
    OTHER = 'OTHER',
}

export enum RescheduleStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    CANCELLED = 'CANCELLED',
}

// ─── Document Interfaces ──────────────────────────────────────────────────────
export interface IMeeting {
    meetingId: string;
    companyId: Types.ObjectId;
    organizerId: Types.ObjectId;
    title: string;
    agenda: string;
    description?: string | null;
    projectId?: Types.ObjectId | null;
    taskId?: Types.ObjectId | null;
    meetingType: MeetingType;
    meetingLink?: string | null;
    meetingProvider?: string | null;
    externalMeetingId?: string | null;
    calendarEventId?: Types.ObjectId | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    durationMinutes: number;
    timezone?: string;
    status: MeetingStatus;
    currentVersion: number;
    reminded15Min?: boolean;
    reminded5Min?: boolean;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
    cancellationReason?: string | null;
    rejectionReason?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IMeetingDocument extends IMeeting, Document {}

export interface IMeetingParticipant {
    meetingId: Types.ObjectId;
    userId: Types.ObjectId;
    companyId: Types.ObjectId;
    role: ParticipantRole;
    responseStatus: ParticipantResponseStatus;
    responseAt?: Date | null;
    joinedAt?: Date | null;
    leftAt?: Date | null;
    rescheduleRequested?: boolean;
    rescheduleReason?: string | null;
    declineReason?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IMeetingParticipantDocument extends IMeetingParticipant, Document {}

export interface IMeetingScheduleHistory {
    meetingId: Types.ObjectId;
    companyId: Types.ObjectId;
    previousStartAt: Date;
    previousEndAt: Date;
    proposedStartAt: Date;
    proposedEndAt: Date;
    durationMinutes: number;
    requestedBy: Types.ObjectId;
    approvedBy?: Types.ObjectId | null;
    reason?: string | null;
    status: RescheduleStatus;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IMeetingScheduleHistoryDocument extends IMeetingScheduleHistory, Document {}

// ─── Request DTOs ─────────────────────────────────────────────────────────────
export interface CreateMeetingRequestDTO {
    title: string;
    agenda: string;
    participantIds: string[];
    preferredStartAt: string | Date;
    durationMinutes: number;
    projectId?: string | null;
    taskId?: string | null;
    description?: string | null;
    meetingType?: MeetingType;
    meetingLink?: string | null;
    timezone?: string;
}

export interface AcceptMeetingDTO {
    note?: string;
}

export interface RejectMeetingDTO {
    reason: string;
}

export interface RescheduleRequestDTO {
    proposedStartAt: string | Date;
    durationMinutes?: number;
    reason: string;
}

export interface ProposeRescheduleDTO {
    proposedStartAt: string | Date;
    durationMinutes?: number;
    reason: string;
}

export interface CancelMeetingDTO {
    reason: string;
}

export interface MeetingListQuery {
    page?: number;
    limit?: number;
    status?: MeetingStatus | string;
    dateFrom?: string;
    dateTo?: string;
    projectId?: string;
    taskId?: string;
    search?: string;
}

export interface AvailabilityQuery {
    userId?: string;
    date: string;
    durationMinutes?: number;
}
