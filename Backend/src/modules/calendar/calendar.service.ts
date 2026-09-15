import { Types } from 'mongoose';
import CalendarEvent from './calendar-event.model';
import { CalendarOAuthService } from './calendar-oauth.service';
import User from '../users/user.model';
import CompanyMember from '../companyadmin/invitations/company-member.model';
import { Project } from '../companyadmin/projects/project.model';
import { Task } from '../tasks/task.model';
import { AppError } from '../../utils/AppError';
import { TokenPayload } from '../../utils/tokens';
import { EntitlementService } from '../../services/entitlement.service';
import {
    ICreateCalendarEventPayload,
    IUpdateCalendarEventPayload,
    IRescheduleEventPayload,
    IRsvpPayload,
    IQuickMeetingPayload,
    ICalendarEventFilterQuery,
    ICalendarParticipant,
} from './calendar.types';

export class CalendarService {
    /**
     * Format a calendar event document into the exact contract expected by frontend clients
     */
    static formatEvent(event: any) {
        return {
            id: event._id ? event._id.toString() : event.id,
            companyId: event.companyId ? event.companyId.toString() : undefined,
            title: event.title,
            description: event.description || '',
            startTime: event.startTime,
            endTime: event.endTime,
            allDay: !!event.allDay,
            timeZone: event.timeZone || 'Asia/Kolkata',
            organizer: event.organizer
                ? {
                    id: event.organizer.userId ? event.organizer.userId.toString() : event.organizer.id,
                    name: event.organizer.name,
                    email: event.organizer.email,
                    avatar: event.organizer.avatar || null,
                    companyId: event.companyId ? event.companyId.toString() : undefined,
                }
                : undefined,
            coOrganizers: (event.coOrganizers || []).map((id: any) => id.toString()),
            participants: (event.participants || []).map((p: any) => ({
                id: p.userId ? p.userId.toString() : p.id,
                userId: p.userId ? p.userId.toString() : p.id,
                name: p.name,
                email: p.email,
                avatar: p.avatar || null,
                role: p.role || null,
                designation: p.designation || null,
                status: p.status,
                isCoOrganizer: !!p.isCoOrganizer,
                ...(p.respondedAt ? { respondedAt: p.respondedAt } : {}),
            })),
            meetingType: event.meetingType || 'video',
            provider: event.provider || 'none',
            meetingUrl: event.meetingUrl || null,
            externalEventId: event.externalEventId || null,
            ...(event.externalProviderData ? { externalProviderData: event.externalProviderData } : {}),
            agenda: event.agenda || [],
            reminderMinutes: event.reminderMinutes ?? 15,
            recurrence: event.recurrence || 'none',
            projectId: event.projectId ? event.projectId.toString() : null,
            projectName: event.projectName || null,
            taskId: event.taskId ? event.taskId.toString() : null,
            taskName: event.taskName || null,
            color: event.color || '#F97316',
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
        };
    }

    /**
     * Get all calendar events matching query parameters within company
     */
    static async getEvents(companyId: string, filters: ICalendarEventFilterQuery) {
        const query: any = {
            companyId: new Types.ObjectId(companyId),
        };

        if (filters.startDate && filters.endDate) {
            query.startTime = { $lte: new Date(filters.endDate) };
            query.endTime = { $gte: new Date(filters.startDate) };
        } else if (filters.startDate) {
            query.endTime = { $gte: new Date(filters.startDate) };
        } else if (filters.endDate) {
            query.startTime = { $lte: new Date(filters.endDate) };
        }

        if (filters.projectId) {
            query.projectId = new Types.ObjectId(filters.projectId);
        }

        if (filters.provider) {
            query.provider = filters.provider;
        }

        if (filters.status) {
            query['participants.status'] = filters.status;
        }

        if (filters.search) {
            const searchRegex = { $regex: filters.search, $options: 'i' };
            query.$or = [
                { title: searchRegex },
                { description: searchRegex },
                { projectName: searchRegex },
            ];
        }

        const events = await CalendarEvent.find(query).sort({ startTime: 1 }).lean();
        return events.map((e) => this.formatEvent(e));
    }

    /**
     * Create a calendar event
     */
    static async createEvent(companyId: string, user: TokenPayload, payload: ICreateCalendarEventPayload) {
        const cId = new Types.ObjectId(companyId);
        const start = new Date(payload.startTime);
        const end = new Date(payload.endTime);

        // Validation 1: startTime must not be in the past (allow 60s clock drift)
        if (start.getTime() < Date.now() - 60000) {
            const error: any = new Error('CANNOT_SCHEDULE_IN_PAST');
            error.statusCode = 400;
            error.details = 'Event start time cannot be in the past.';
            throw error;
        }

        // Validation 2: endTime strictly after startTime
        if (end.getTime() <= start.getTime()) {
            const error: any = new Error('INVALID_TIME_RANGE');
            error.statusCode = 400;
            error.details = 'Event end time must be after start time.';
            throw error;
        }

        // Validation 3: Multi-tenant tenant isolation for all participantIds and coOrganizers
        const requestedIds = Array.from(
            new Set([...(payload.participantIds || []), ...(payload.coOrganizers || [])])
        );

        const participantMembersMap = new Map<string, any>();
        const participantUsersMap = new Map<string, any>();

        if (requestedIds.length > 0) {
            const objectIds = requestedIds.map((id) => new Types.ObjectId(id));

            const [companyMembers, directUsers] = await Promise.all([
                CompanyMember.find({ companyId: cId, userId: { $in: objectIds } })
                    .populate('roleId', 'name')
                    .populate('designationId', 'title name')
                    .lean(),
                User.find({ _id: { $in: objectIds }, companyId: cId })
                    .populate('role', 'name')
                    .select('name email avatar role')
                    .lean(),
            ]);

            companyMembers.forEach((m) => participantMembersMap.set(m.userId.toString(), m));
            directUsers.forEach((u) => participantUsersMap.set(u._id.toString(), u));

            for (const id of requestedIds) {
                if (!participantMembersMap.has(id) && !participantUsersMap.has(id)) {
                    const err: any = new Error('CROSS_TENANT_INVITATION_FORBIDDEN');
                    err.statusCode = 403;
                    err.details = 'Every participantId must belong to your organization.';
                    throw err;
                }
            }
        }

        // Resolve organizer
        const organizerDoc = await User.findById(user.userId).select('name email avatar role').lean();
        const organizerName = organizerDoc?.name || user.email.split('@')[0];
        const organizerEmail = organizerDoc?.email || user.email;
        const organizerAvatar = (organizerDoc as any)?.avatar || null;

        const organizer = {
            userId: new Types.ObjectId(user.userId),
            name: organizerName,
            email: organizerEmail,
            avatar: organizerAvatar,
        };

        // Build participants list (Organizer included as organizer status)
        const participants: ICalendarParticipant[] = [
            {
                userId: new Types.ObjectId(user.userId),
                name: organizerName,
                email: organizerEmail,
                avatar: organizerAvatar,
                role: (organizerDoc?.role as any)?.name || 'Admin',
                designation: 'Organizer',
                status: 'organizer',
                isCoOrganizer: false,
                respondedAt: new Date(),
            },
        ];

        const coOrganizerSet = new Set((payload.coOrganizers || []).map((id) => id.toString()));

        for (const pId of payload.participantIds || []) {
            if (pId === user.userId) continue;

            const member = participantMembersMap.get(pId);
            const userObj = participantUsersMap.get(pId);

            const pName = userObj?.name || 'Participant';
            const pEmail = userObj?.email || '';
            const pAvatar = userObj?.avatar || null;
            const pRole = member?.roleId?.name || (userObj?.role as any)?.name || 'Member';
            const pDesignation = member?.designationId?.title || member?.designationId?.name || null;

            participants.push({
                userId: new Types.ObjectId(pId),
                name: pName,
                email: pEmail,
                avatar: pAvatar,
                role: pRole,
                designation: pDesignation,
                status: 'pending',
                isCoOrganizer: coOrganizerSet.has(pId),
            });
        }

        // Project and Task denormalization
        let projectName: string | undefined;
        let taskName: string | undefined;

        if (payload.projectId) {
            const project = await Project.findOne({ _id: payload.projectId, companyId: cId }).select('name').lean();
            if (project) {
                projectName = project.name;
            }
        }

        if (payload.taskId) {
            const task = await Task.findOne({ _id: payload.taskId, companyId: cId }).select('title').lean();
            if (task) {
                taskName = task.title;
            }
        }

        // Provider entitlement verification
        const provider = payload.provider || 'none';
        if (provider === 'google_meet') {
            const hasGoogle = await EntitlementService.hasFeature(companyId, 'GOOGLE_MEET');
            if (!hasGoogle) {
                const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                err.statusCode = 403;
                err.details = 'Google Meet integration is not included in your current subscription plan. Please upgrade your plan.';
                throw err;
            }
        } else if (provider === 'ms_teams') {
            const hasTeams = await EntitlementService.hasFeature(companyId, 'MS_TEAMS');
            if (!hasTeams) {
                const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                err.statusCode = 403;
                err.details = 'Microsoft Teams integration is not included in your current subscription plan. Please upgrade your plan.';
                throw err;
            }
        }

        // Meeting URL generation via OAuth or fallback
        const participantEmails = participants.map((p) => p.email).filter(Boolean);
        const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
            companyId,
            user.userId,
            provider,
            {
                title: payload.title,
                description: payload.description,
                startTime: start,
                endTime: end,
                timeZone: payload.timeZone,
                participantEmails,
            }
        );

        const newEvent: any = await CalendarEvent.create({
            companyId: cId,
            title: payload.title,
            description: payload.description || '',
            startTime: start,
            endTime: end,
            allDay: payload.allDay || false,
            timeZone: payload.timeZone || 'Asia/Kolkata',
            organizer,
            coOrganizers: (payload.coOrganizers || []).map((id) => new Types.ObjectId(id)),
            participants,
            meetingType: payload.meetingType || 'video',
            provider,
            meetingUrl: meetingDetails.meetingUrl || null,
            externalEventId: meetingDetails.externalEventId || null,
            externalProviderData: meetingDetails.externalProviderData,
            agenda: payload.agenda || [],
            reminderMinutes: payload.reminderMinutes ?? 15,
            recurrence: payload.recurrence || 'none',
            projectId: payload.projectId ? new Types.ObjectId(payload.projectId) : null,
            projectName,
            taskId: payload.taskId ? new Types.ObjectId(payload.taskId) : null,
            taskName,
            color: payload.color || '#F97316',
        });

        return this.formatEvent(newEvent);
    }

    /**
     * Update an existing calendar event
     */
    static async updateEvent(
        companyId: string,
        user: TokenPayload,
        eventId: string,
        payload: IUpdateCalendarEventPayload
    ) {
        const cId = new Types.ObjectId(companyId);
        const event = await CalendarEvent.findOne({ _id: eventId, companyId: cId });

        if (!event) {
            throw AppError.notFound('Calendar event not found');
        }

        // Permission check: only organizer or company admin
        const isOrganizer = event.organizer.userId.toString() === user.userId;
        const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'].includes((user.role || '').toUpperCase());
        if (!isOrganizer && !isAdmin) {
            const err: any = new Error('FORBIDDEN');
            err.statusCode = 403;
            err.details = 'Only the event organizer or a Company Admin can update the event.';
            throw err;
        }

        // If times are modified, validate them
        const newStart = payload.startTime ? new Date(payload.startTime) : event.startTime;
        const newEnd = payload.endTime ? new Date(payload.endTime) : event.endTime;

        if (payload.startTime && newStart.getTime() < Date.now() - 60000) {
            const error: any = new Error('CANNOT_SCHEDULE_IN_PAST');
            error.statusCode = 400;
            error.details = 'Event start time cannot be in the past.';
            throw error;
        }

        if (newEnd.getTime() <= newStart.getTime()) {
            const error: any = new Error('INVALID_TIME_RANGE');
            error.statusCode = 400;
            error.details = 'Event end time must be after start time.';
            throw error;
        }

        event.startTime = newStart;
        event.endTime = newEnd;

        if (payload.title !== undefined) event.title = payload.title;
        if (payload.description !== undefined) event.description = payload.description;
        if (payload.allDay !== undefined) event.allDay = payload.allDay;
        if (payload.timeZone !== undefined) event.timeZone = payload.timeZone;
        if (payload.meetingType !== undefined) event.meetingType = payload.meetingType;
        if (payload.agenda !== undefined) event.agenda = payload.agenda;
        if (payload.reminderMinutes !== undefined) event.reminderMinutes = payload.reminderMinutes;
        if (payload.recurrence !== undefined) event.recurrence = payload.recurrence;
        if (payload.color !== undefined) event.color = payload.color;

        // Project and Task
        if (payload.projectId !== undefined) {
            if (payload.projectId) {
                const project = await Project.findOne({ _id: payload.projectId, companyId: cId }).select('name').lean();
                event.projectId = new Types.ObjectId(payload.projectId);
                event.projectName = project?.name || undefined;
            } else {
                event.projectId = undefined;
                event.projectName = undefined;
            }
        }

        if (payload.taskId !== undefined) {
            if (payload.taskId) {
                const task = await Task.findOne({ _id: payload.taskId, companyId: cId }).select('title').lean();
                event.taskId = new Types.ObjectId(payload.taskId);
                event.taskName = task?.title || undefined;
            } else {
                event.taskId = undefined;
                event.taskName = undefined;
            }
        }

        // Provider change
        if (payload.provider !== undefined && payload.provider !== event.provider) {
            if (payload.provider === 'google_meet') {
                const hasGoogle = await EntitlementService.hasFeature(companyId, 'GOOGLE_MEET');
                if (!hasGoogle) {
                    const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                    err.statusCode = 403;
                    err.details = 'Google Meet integration is not included in your current subscription plan. Please upgrade your plan.';
                    throw err;
                }
            } else if (payload.provider === 'ms_teams') {
                const hasTeams = await EntitlementService.hasFeature(companyId, 'MS_TEAMS');
                if (!hasTeams) {
                    const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                    err.statusCode = 403;
                    err.details = 'Microsoft Teams integration is not included in your current subscription plan. Please upgrade your plan.';
                    throw err;
                }
            }

            event.provider = payload.provider;
            const participantEmails = event.participants.map((p) => p.email).filter(Boolean);
            const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
                companyId,
                user.userId,
                payload.provider,
                {
                    title: event.title,
                    description: event.description,
                    startTime: event.startTime,
                    endTime: event.endTime,
                    timeZone: event.timeZone,
                    participantEmails,
                }
            );
            event.meetingUrl = meetingDetails.meetingUrl;
            event.externalEventId = meetingDetails.externalEventId;
            event.externalProviderData = meetingDetails.externalProviderData;
        }

        // Participants update
        if (payload.participantIds !== undefined || payload.coOrganizers !== undefined) {
            const newParticipantIds = payload.participantIds !== undefined
                ? payload.participantIds
                : event.participants.map((p) => p.userId.toString()).filter((id) => id !== event.organizer.userId.toString());

            const newCoOrganizers = payload.coOrganizers !== undefined
                ? payload.coOrganizers
                : event.coOrganizers.map((id) => id.toString());

            // Validate cross-tenant
            const requestedIds = Array.from(new Set([...newParticipantIds, ...newCoOrganizers]));
            if (requestedIds.length > 0) {
                const objectIds = requestedIds.map((id) => new Types.ObjectId(id));
                const [members, users] = await Promise.all([
                    CompanyMember.find({ companyId: cId, userId: { $in: objectIds } }).lean(),
                    User.find({ _id: { $in: objectIds }, companyId: cId }).lean(),
                ]);

                const validSet = new Set([
                    ...members.map((m) => m.userId.toString()),
                    ...users.map((u) => u._id.toString()),
                ]);

                for (const id of requestedIds) {
                    if (!validSet.has(id)) {
                        const err: any = new Error('CROSS_TENANT_INVITATION_FORBIDDEN');
                        err.statusCode = 403;
                        err.details = 'Every participantId must belong to your organization.';
                        throw err;
                    }
                }
            }

            event.coOrganizers = newCoOrganizers.map((id) => new Types.ObjectId(id));
            const coOrganizerSet = new Set(newCoOrganizers);

            // Retain existing participant responses where available
            const existingMap = new Map<string, any>();
            event.participants.forEach((p) => existingMap.set(p.userId.toString(), p));

            const updatedParticipants: ICalendarParticipant[] = [];

            // Preserve organizer
            const organizerP = existingMap.get(event.organizer.userId.toString()) || {
                userId: event.organizer.userId,
                name: event.organizer.name,
                email: event.organizer.email,
                avatar: event.organizer.avatar,
                role: 'organizer',
                designation: 'Organizer',
                status: 'organizer',
                isCoOrganizer: false,
                respondedAt: new Date(),
            };
            updatedParticipants.push(organizerP);

            // Append other participants
            for (const pId of newParticipantIds) {
                if (pId === event.organizer.userId.toString()) continue;

                const existing = existingMap.get(pId);
                if (existing) {
                    existing.isCoOrganizer = coOrganizerSet.has(pId);
                    updatedParticipants.push(existing);
                } else {
                    const userObj = await User.findById(pId).select('name email avatar role').lean();
                    const member = await CompanyMember.findOne({ companyId: cId, userId: pId })
                        .populate('roleId', 'name')
                        .populate('designationId', 'title name')
                        .lean();

                    updatedParticipants.push({
                        userId: new Types.ObjectId(pId),
                        name: userObj?.name || 'Participant',
                        email: userObj?.email || '',
                        avatar: (userObj as any)?.avatar || null,
                        role: (member?.roleId as any)?.name || (userObj?.role as any)?.name || 'Member',
                        designation: (member?.designationId as any)?.title || (member?.designationId as any)?.name || null,
                        status: 'pending',
                        isCoOrganizer: coOrganizerSet.has(pId),
                    });
                }
            }

            event.participants = updatedParticipants;
        }

        await event.save();
        return this.formatEvent(event);
    }

    /**
     * Reschedule an event (Drag & drop or duration resize)
     */
    static async rescheduleEvent(
        companyId: string,
        user: TokenPayload,
        eventId: string,
        payload: IRescheduleEventPayload
    ) {
        const cId = new Types.ObjectId(companyId);
        const event = await CalendarEvent.findOne({ _id: eventId, companyId: cId });

        if (!event) {
            throw AppError.notFound('Calendar event not found');
        }

        // Authorization check
        const isOrganizer = event.organizer.userId.toString() === user.userId;
        const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'].includes((user.role || '').toUpperCase());
        if (!isOrganizer && !isAdmin) {
            const err: any = new Error('FORBIDDEN');
            err.statusCode = 403;
            err.details = 'Only the event organizer or a Company Admin can reschedule the event.';
            throw err;
        }

        const start = new Date(payload.startTime);
        const end = new Date(payload.endTime);

        // Validation: start must not be in past
        if (start.getTime() < Date.now() - 60000) {
            const error: any = new Error('CANNOT_SCHEDULE_IN_PAST');
            error.statusCode = 400;
            error.details = 'Event start time cannot be in the past.';
            throw error;
        }

        if (end.getTime() <= start.getTime()) {
            const error: any = new Error('INVALID_TIME_RANGE');
            error.statusCode = 400;
            error.details = 'Event end time must be after start time.';
            throw error;
        }

        event.startTime = start;
        event.endTime = end;
        await event.save();

        return {
            id: event._id.toString(),
            startTime: event.startTime,
            endTime: event.endTime,
            updatedAt: event.updatedAt,
        };
    }

    /**
     * Respond to meeting invitation (RSVP)
     */
    static async rsvpEvent(companyId: string, userId: string, eventId: string, payload: IRsvpPayload) {
        const cId = new Types.ObjectId(companyId);
        const event = await CalendarEvent.findOne({ _id: eventId, companyId: cId });

        if (!event) {
            throw AppError.notFound('Calendar event not found');
        }

        const participant = event.participants.find((p) => p.userId.toString() === userId);
        if (!participant) {
            const err: any = new Error('NOT_FOUND');
            err.statusCode = 404;
            err.details = 'Participant not found in meeting invitation';
            throw err;
        }

        participant.status = payload.status;
        participant.respondedAt = new Date();

        await event.save();

        return {
            eventId: event._id.toString(),
            userId,
            status: participant.status,
            respondedAt: participant.respondedAt,
        };
    }

    /**
     * Delete / cancel event
     */
    static async deleteEvent(companyId: string, user: TokenPayload, eventId: string) {
        const cId = new Types.ObjectId(companyId);
        const event = await CalendarEvent.findOne({ _id: eventId, companyId: cId });

        if (!event) {
            throw AppError.notFound('Calendar event not found');
        }

        const isOrganizer = event.organizer.userId.toString() === user.userId;
        const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN'].includes((user.role || '').toUpperCase());
        if (!isOrganizer && !isAdmin) {
            const err: any = new Error('FORBIDDEN');
            err.statusCode = 403;
            err.details = 'Only the event organizer or a Company Admin can cancel the event.';
            throw err;
        }

        await CalendarEvent.deleteOne({ _id: eventId, companyId: cId });
        return { success: true };
    }

    /**
     * Quick Meeting Generator: Instant 1-click room creation
     */
    static async quickMeeting(companyId: string, user: TokenPayload, payload: IQuickMeetingPayload) {
        const cId = new Types.ObjectId(companyId);
        const durationMinutes = payload.durationMinutes || 30;
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
        const provider = payload.provider || 'google_meet';
        const title = payload.title || `Instant Sync with ${user.email.split('@')[0]}`;

        // 1. Check provider entitlement
        if (provider === 'google_meet') {
            const hasGoogle = await EntitlementService.hasFeature(companyId, 'GOOGLE_MEET');
            if (!hasGoogle) {
                const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                err.statusCode = 403;
                err.details = 'Google Meet is not included in your current subscription plan. Please upgrade your plan to use Google Meet.';
                throw err;
            }
        } else if (provider === 'ms_teams') {
            const hasTeams = await EntitlementService.hasFeature(companyId, 'MS_TEAMS');
            if (!hasTeams) {
                const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
                err.statusCode = 403;
                err.details = 'Microsoft Teams is not included in your current subscription plan. Please upgrade your plan to use Microsoft Teams.';
                throw err;
            }
        }

        // 2. Check quick meetings quota limit based on plan
        const qmLimits = await EntitlementService.getQuickMeetingLimits(companyId);
        if (!qmLimits.enabled) {
            const err: any = new Error('FEATURE_NOT_INCLUDED_IN_PLAN');
            err.statusCode = 403;
            err.details = 'Quick Meetings feature is not included in your current subscription plan.';
            throw err;
        }

        if (!qmLimits.isUnlimited) {
            const now = new Date();
            const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
            const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

            const usedThisMonth = await CalendarEvent.countDocuments({
                companyId: cId,
                isQuickMeeting: true,
                createdAt: { $gte: startOfMonth, $lte: endOfMonth },
            });

            if (usedThisMonth >= qmLimits.monthlyLimit) {
                const err: any = new Error('QUICK_MEETING_LIMIT_REACHED');
                err.statusCode = 403;
                err.details = `You have reached your monthly limit of ${qmLimits.monthlyLimit} quick meetings for your ${qmLimits.billingCycle} plan. Please upgrade your plan for higher limits.`;
                throw err;
            }
        }

        const organizerDoc = await User.findById(user.userId).select('name email avatar role').lean();
        const organizerName = organizerDoc?.name || user.email.split('@')[0];
        const organizerEmail = organizerDoc?.email || user.email;
        const organizerAvatar = (organizerDoc as any)?.avatar || null;

        const organizer = {
            userId: new Types.ObjectId(user.userId),
            name: organizerName,
            email: organizerEmail,
            avatar: organizerAvatar,
        };

        const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
            companyId,
            user.userId,
            provider,
            {
                title,
                description: 'Instant meeting generated via WorkSphere Quick Meeting',
                startTime,
                endTime,
                timeZone: 'Asia/Kolkata',
                participantEmails: [organizerEmail],
            }
        );

        const event: any = await CalendarEvent.create({
            companyId: cId,
            title,
            description: 'Instant meeting generated via WorkSphere Quick Meeting',
            startTime,
            endTime,
            allDay: false,
            timeZone: 'Asia/Kolkata',
            organizer,
            coOrganizers: [],
            participants: [
                {
                    userId: new Types.ObjectId(user.userId),
                    name: organizerName,
                    email: organizerEmail,
                    avatar: organizerAvatar,
                    role: (organizerDoc?.role as any)?.name || 'Admin',
                    designation: 'Organizer',
                    status: 'organizer',
                    isCoOrganizer: false,
                    respondedAt: new Date(),
                },
            ],
            meetingType: 'video',
            provider,
            meetingUrl: meetingDetails.meetingUrl || null,
            externalEventId: meetingDetails.externalEventId || null,
            externalProviderData: meetingDetails.externalProviderData,
            agenda: [],
            reminderMinutes: 15,
            recurrence: 'none',
            color: '#F97316',
            isQuickMeeting: true,
        });

        return {
            id: event._id.toString(),
            title: event.title,
            meetingUrl: event.meetingUrl,
            provider: event.provider,
            startTime: event.startTime,
            endTime: event.endTime,
        };
    }

    /**
     * Get calendar entitlements & monthly Quick Meeting quota usage
     */
    static async getCalendarEntitlements(companyId: string) {
        const cId = new Types.ObjectId(companyId);
        const [googleMeetEnabled, msTeamsEnabled, qmLimits] = await Promise.all([
            EntitlementService.hasFeature(companyId, 'GOOGLE_MEET'),
            EntitlementService.hasFeature(companyId, 'MS_TEAMS'),
            EntitlementService.getQuickMeetingLimits(companyId),
        ]);

        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

        const usedThisMonth = await CalendarEvent.countDocuments({
            companyId: cId,
            isQuickMeeting: true,
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        });

        const remainingThisMonth = qmLimits.isUnlimited
            ? -1
            : Math.max(0, qmLimits.monthlyLimit - usedThisMonth);

        return {
            providers: {
                google_meet: {
                    enabled: googleMeetEnabled,
                    featureKey: 'GOOGLE_MEET',
                },
                ms_teams: {
                    enabled: msTeamsEnabled,
                    featureKey: 'MS_TEAMS',
                },
            },
            quickMeetings: {
                enabled: qmLimits.enabled,
                monthlyLimit: qmLimits.monthlyLimit,
                isUnlimited: qmLimits.isUnlimited,
                usedThisMonth,
                remainingThisMonth,
                billingCycle: qmLimits.billingCycle,
                planName: qmLimits.planName,
            },
            googleMeetEnabled,
            msTeamsEnabled,
        };
    }
}
