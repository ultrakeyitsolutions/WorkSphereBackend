import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createCalendarEventSchema = z.object({
    title: z.string().min(1, 'Title cannot be empty').trim(),
    description: z.string().optional().default(''),
    startTime: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date for startTime' }
    ),
    endTime: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date for endTime' }
    ),
    allDay: z.boolean().optional().default(false),
    timeZone: z.string().optional().default('Asia/Kolkata'),
    participantIds: z.array(z.string().regex(objectIdRegex, 'Invalid participant ObjectId')).optional().default([]),
    coOrganizers: z.array(z.string().regex(objectIdRegex, 'Invalid coOrganizer ObjectId')).optional().default([]),
    meetingType: z.enum(['video', 'in_person', 'phone', 'sync']).optional().default('video'),
    provider: z.enum(['none', 'google_meet', 'ms_teams']).optional().default('none'),
    agenda: z.array(z.string().trim()).optional().default([]),
    reminderMinutes: z.union([
        z.literal(0),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
    ]).optional().default(15),
    recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional().default('none'),
    projectId: z.string().regex(objectIdRegex, 'Invalid project ObjectId').optional(),
    taskId: z.string().regex(objectIdRegex, 'Invalid task ObjectId').optional(),
    color: z.string().optional().default('#F97316'),
});

export const updateCalendarEventSchema = z.object({
    title: z.string().min(1, 'Title cannot be empty').trim().optional(),
    description: z.string().optional(),
    startTime: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid ISO date for startTime' }).optional(),
    endTime: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid ISO date for endTime' }).optional(),
    allDay: z.boolean().optional(),
    timeZone: z.string().optional(),
    participantIds: z.array(z.string().regex(objectIdRegex, 'Invalid participant ObjectId')).optional(),
    coOrganizers: z.array(z.string().regex(objectIdRegex, 'Invalid coOrganizer ObjectId')).optional(),
    meetingType: z.enum(['video', 'in_person', 'phone', 'sync']).optional(),
    provider: z.enum(['none', 'google_meet', 'ms_teams']).optional(),
    agenda: z.array(z.string().trim()).optional(),
    reminderMinutes: z.union([
        z.literal(0),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
    ]).optional(),
    recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
    projectId: z.string().regex(objectIdRegex, 'Invalid project ObjectId').nullable().optional(),
    taskId: z.string().regex(objectIdRegex, 'Invalid task ObjectId').nullable().optional(),
    color: z.string().optional(),
});

export const rescheduleEventSchema = z.object({
    startTime: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date for startTime' }
    ),
    endTime: z.string().refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Invalid ISO date for endTime' }
    ),
});

export const rsvpSchema = z.object({
    status: z.enum(['accepted', 'declined', 'tentative']),
});

export const quickMeetingSchema = z.object({
    title: z.string().trim().optional().default('Quick Meeting'),
    provider: z.enum(['google_meet', 'ms_teams']).optional().default('google_meet'),
    durationMinutes: z.number().int().min(5).max(480).optional().default(30),
    projectId: z.string().regex(objectIdRegex, 'Invalid project ObjectId').optional(),
    participantIds: z.array(z.string().regex(objectIdRegex, 'Invalid participant ObjectId')).optional().default([]),
    description: z.string().optional(),
});

export const connectOAuthSchema = z.object({
    code: z.string().min(1, 'OAuth authorization code is required'),
    redirectUri: z.string().min(1, 'redirectUri is required'),
});
