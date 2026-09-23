import { z } from 'zod';
import { MeetingType } from './meeting.types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createMeetingRequestSchema = z.object({
    title: z.string().min(1, 'Meeting title is required').max(200).trim(),
    agenda: z.string().min(1, 'Meeting agenda is required').max(2000).trim(),
    description: z.string().max(4000).optional().nullable(),
    participantIds: z
        .array(z.string().regex(objectIdRegex, 'Invalid participant user ID'))
        .min(1, 'At least one participant is required'),
    preferredStartAt: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date string for preferredStartAt' }
    ),
    durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
    projectId: z.string().regex(objectIdRegex, 'Invalid project ID').optional().nullable(),
    taskId: z.string().regex(objectIdRegex, 'Invalid task ID').optional().nullable(),
    meetingType: z.nativeEnum(MeetingType).optional().default(MeetingType.QUICK),
    meetingLink: z.string().url('Invalid meeting link URL').optional().nullable().or(z.literal('')),
    timezone: z.string().optional().default('UTC'),
});

export const acceptMeetingSchema = z.object({
    note: z.string().max(1000).optional().nullable(),
});

export const rejectMeetingSchema = z.object({
    reason: z.string().min(1, 'Rejection reason is required').max(1000).trim(),
});

export const rescheduleRequestSchema = z.object({
    proposedStartAt: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date string for proposedStartAt' }
    ),
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
    reason: z.string().min(1, 'Reschedule reason is required').max(1000).trim(),
});

export const proposeRescheduleSchema = z.object({
    proposedStartAt: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date string for proposedStartAt' }
    ),
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
    reason: z.string().min(1, 'Proposal reason is required').max(1000).trim(),
});

export const cancelMeetingSchema = z.object({
    reason: z.string().min(1, 'Cancellation reason is required').max(1000).trim(),
});

export const meetingListQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    status: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    projectId: z.string().regex(objectIdRegex, 'Invalid project ID').optional(),
    taskId: z.string().regex(objectIdRegex, 'Invalid task ID').optional(),
    search: z.string().optional(),
});

export const availabilityQuerySchema = z.object({
    userId: z.string().regex(objectIdRegex, 'Invalid user ID').optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
    durationMinutes: z.coerce.number().int().min(5).max(480).optional().default(30),
});
