import crypto from 'crypto';
import { Types } from 'mongoose';
import { Meeting } from './models/meeting.model';
import { MeetingParticipant } from './models/meeting-participant.model';
import { MeetingValidationService } from './meeting-validation.service';
import { MeetingSchedulingService } from './meeting-scheduling.service';
import { MeetingNotificationService } from './meeting-notification.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { CalendarOAuthService } from '../calendar/calendar-oauth.service';
import CalendarEvent from '../calendar/calendar-event.model';
import { EntitlementService } from '../../services/entitlement.service';
import User from '../users/user.model';
import { AppError } from '../../utils/AppError';
import {
    CreateMeetingRequestDTO,
    MeetingStatus,
    MeetingType,
    ParticipantRole,
    ParticipantResponseStatus,
} from './meeting.types';

export class MeetingRequestService {
    /**
     * Create a new Meeting Request (Scheduled or Quick Sync with auto room generation)
     */
    public static async createRequest(
        companyId: string,
        requesterId: string,
        dto: CreateMeetingRequestDTO,
        req?: any
    ): Promise<any> {
        // 1. Validate Requester
        const { user: requester } = await MeetingValidationService.validateRequester(
            requesterId,
            companyId
        );

        // 2. Validate Participants (Tenant isolation enforced)
        const { validParticipantIds } =
            await MeetingValidationService.validateParticipants(
                dto.participantIds,
                companyId,
                requesterId
            );

        // 3. Validate Project & Task Associations
        let projectDoc: any = null;
        let taskDoc: any = null;

        if (dto.projectId) {
            projectDoc = await MeetingValidationService.validateProject(
                dto.projectId,
                companyId,
                requesterId,
                requester.role?.name
            );
        }

        if (dto.taskId) {
            taskDoc = await MeetingValidationService.validateTask(
                dto.taskId,
                companyId,
                dto.projectId
            );
        }

        // 4. Calculate Schedules
        const startAt = new Date(dto.preferredStartAt);
        const duration = dto.durationMinutes || 30;
        const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

        if (isNaN(startAt.getTime())) {
            const err: any = new Error('Invalid preferred start date/time');
            err.statusCode = 400;
            throw err;
        }

        // 5. Conflict Detection
        const allUserIds = [requesterId, ...validParticipantIds.map((id) => id.toString())];
        const conflictResult = await MeetingSchedulingService.checkConflicts(
            companyId,
            allUserIds,
            startAt,
            endAt
        );

        // 6. Fetch participants email for calendar invitations
        const participantUsers = await User.find({
            _id: { $in: validParticipantIds },
            companyId: new Types.ObjectId(companyId),
        }).select('name email avatar role').lean();
        const participantEmails = participantUsers.map((u) => u.email).filter(Boolean);

        // 7. Auto-generate Video Conference URL if provider selected
        let meetingLink = dto.meetingLink ? dto.meetingLink.trim() : null;
        let meetingProvider = dto.provider || (dto.meetingLink ? 'manual' : null);
        let externalMeetingId: string | null = null;
        let externalProviderData: any = null;

        if (dto.provider === 'google_meet' || dto.provider === 'ms_teams') {
            const featureKey = dto.provider === 'google_meet' ? 'GOOGLE_MEET' : 'MS_TEAMS';
            const hasFeature = await EntitlementService.hasFeature(companyId, featureKey);
            if (!hasFeature) {
                throw AppError.forbidden(
                    `${dto.provider === 'google_meet' ? 'Google Meet' : 'Microsoft Teams'} is not included in your subscription plan.`
                );
            }

            try {
                const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
                    companyId,
                    requesterId,
                    dto.provider,
                    {
                        title: dto.title.trim(),
                        description: dto.description || dto.agenda,
                        startTime: startAt,
                        endTime: endAt,
                        timeZone: dto.timezone || 'Asia/Kolkata',
                        participantEmails,
                    }
                );

                if (meetingDetails.meetingUrl) {
                    meetingLink = meetingDetails.meetingUrl;
                    externalMeetingId = meetingDetails.externalEventId || null;
                    externalProviderData = meetingDetails.externalProviderData || null;
                    meetingProvider = dto.provider;
                }
            } catch (providerErr: any) {
                console.warn(`[MeetingRequestService] Conference auto-generation warning for ${dto.provider}:`, providerErr.message);
                if (!dto.meetingLink) {
                    // Re-throw if caller explicitly requested provider room and no manual fallback provided
                    throw providerErr;
                }
            }
        }

        // 8. Generate human-readable Unique Meeting ID
        const shortHash = crypto.randomBytes(4).toString('hex');
        const meetingIdStr = `ws-meet-${Date.now().toString(36)}-${shortHash}`;

        const initialStatus = (!meetingLink && dto.provider === 'manual') 
            ? MeetingStatus.PENDING_LINK 
            : MeetingStatus.PENDING;

        // 9. Persist Meeting Document
        const meeting = await Meeting.create({
            meetingId: meetingIdStr,
            companyId: new Types.ObjectId(companyId),
            organizerId: new Types.ObjectId(requesterId),
            title: dto.title.trim(),
            agenda: dto.agenda.trim(),
            description: dto.description ? dto.description.trim() : null,
            projectId: projectDoc ? projectDoc._id : null,
            taskId: taskDoc ? taskDoc._id : null,
            meetingType: dto.meetingType || MeetingType.SCHEDULED,
            meetingLink: meetingLink || null,
            meetingProvider: meetingProvider || null,
            externalMeetingId: externalMeetingId || null,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes: duration,
            timezone: dto.timezone || 'UTC',
            status: initialStatus,
            currentVersion: 1,
        });

        // 10. Create Participant Records (Organizer + Invited Participants)
        const participantDocs = [
            {
                meetingId: meeting._id,
                userId: new Types.ObjectId(requesterId),
                companyId: new Types.ObjectId(companyId),
                role: ParticipantRole.ORGANIZER,
                responseStatus: ParticipantResponseStatus.ACCEPTED,
                responseAt: new Date(),
            },
            ...validParticipantIds.map((pId) => ({
                meetingId: meeting._id,
                userId: pId,
                companyId: new Types.ObjectId(companyId),
                role: ParticipantRole.REQUIRED,
                responseStatus: ParticipantResponseStatus.PENDING,
            })),
        ];

        await MeetingParticipant.insertMany(participantDocs);

        // 11. Bidirectional Bridge: Create Synchronized CalendarEvent
        try {
            const calendarParticipants = [
                {
                    userId: new Types.ObjectId(requesterId),
                    name: requester.name || requester.email,
                    email: requester.email,
                    avatar: (requester as any).avatar || null,
                    role: (requester.role as any)?.name || 'Organizer',
                    designation: 'Organizer',
                    status: 'organizer' as const,
                    isCoOrganizer: false,
                    respondedAt: new Date(),
                },
                ...participantUsers.map((u) => ({
                    userId: u._id,
                    name: u.name || u.email,
                    email: u.email,
                    avatar: (u as any).avatar || null,
                    role: ((u as any).role as any)?.name || 'Member',
                    designation: 'Participant',
                    status: 'pending' as const,
                    isCoOrganizer: false,
                })),
            ];

            const calendarEvent = await CalendarEvent.create({
                companyId: new Types.ObjectId(companyId),
                title: meeting.title,
                description: meeting.description || meeting.agenda || '',
                startTime: startAt,
                endTime: endAt,
                allDay: false,
                timeZone: dto.timezone || 'Asia/Kolkata',
                organizer: {
                    userId: new Types.ObjectId(requesterId),
                    name: requester.name || requester.email,
                    email: requester.email,
                    avatar: (requester as any).avatar || null,
                },
                coOrganizers: [],
                participants: calendarParticipants,
                meetingType: 'video',
                provider: (meetingProvider === 'google_meet' || meetingProvider === 'ms_teams') ? meetingProvider : 'none',
                meetingUrl: meetingLink || null,
                externalEventId: externalMeetingId || null,
                externalProviderData: externalProviderData || null,
                agenda: dto.agenda ? [dto.agenda] : [],
                reminderMinutes: 15,
                recurrence: 'none',
                projectId: projectDoc ? projectDoc._id : null,
                projectName: projectDoc ? projectDoc.name : null,
                taskId: taskDoc ? taskDoc._id : null,
                taskName: taskDoc ? taskDoc.title : null,
                color: '#F97316',
                isQuickMeeting: false,
            });

            meeting.calendarEventId = (calendarEvent as any)?._id;
            await meeting.save();
        } catch (calErr: any) {
            console.error('[MeetingRequestService] CalendarEvent synchronization warning:', calErr.message);
        }

        // 12. Audit Logging
        await AuditLogService.log({
            action: AuditAction.MEETING_CREATED,
            actorId: requesterId,
            companyId,
            targetUserId: validParticipantIds[0] ? validParticipantIds[0].toString() : null,
            metadata: {
                meetingId: meeting._id.toString(),
                customMeetingId: meetingIdStr,
                title: meeting.title,
                scheduledStartAt: startAt,
                durationMinutes: duration,
                participantCount: validParticipantIds.length,
                hasConflict: conflictResult.hasConflict,
                provider: meetingProvider,
            },
            success: true,
            description: `Meeting request created: "${meeting.title}" by ${requester.name || requester.email}`,
            req,
        });

        // 13. Centralized Notification Dispatch (Deduplicated recipient IDs & Role-aware links)
        const uniqueRecipients = Array.from(new Set(validParticipantIds.map((id) => id.toString())));
        const isAdmin = ['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes((requester.role?.name || '').toUpperCase());
        const notificationUrl = isAdmin 
            ? `/companyadmin/pages/meetings?meetingId=${meeting._id}&tab=inbox`
            : `/main/meetings?meetingId=${meeting._id}&tab=inbox`;

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_REQUESTED',
            companyId,
            actorId: requesterId,
            meetingId: meeting._id.toString(),
            recipientIds: uniqueRecipients,
            meetingTitle: meeting.title,
            projectName: projectDoc ? projectDoc.name : undefined,
            agenda: meeting.agenda,
            scheduledStartAt: startAt,
            meetingLink: meeting.meetingLink || undefined,
            actionUrl: notificationUrl,
            metadata: {
                actorName: requester.name || requester.email,
                hasConflict: conflictResult.hasConflict,
                provider: meetingProvider,
            },
        });

        return {
            meeting,
            participants: participantDocs,
            conflicts: conflictResult,
        };
    }

    /**
     * Get pending meeting requests requiring the user's action
     */
    public static async getPendingRequests(
        companyId: string,
        userId: string
    ): Promise<any[]> {
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        // Find meetings where this user is a participant with responseStatus: PENDING
        const pendingParticipants = await MeetingParticipant.find({
            companyId: companyObjectId,
            userId: userObjectId,
            responseStatus: {
                $in: [
                    ParticipantResponseStatus.PENDING,
                    ParticipantResponseStatus.RESCHEDULE_REQUESTED,
                ],
            },
        }).lean();

        if (pendingParticipants.length === 0) {
            return [];
        }

        const meetingIds = pendingParticipants.map((p) => p.meetingId);

        const meetings = await Meeting.find({
            _id: { $in: meetingIds },
            companyId: companyObjectId,
            status: {
                $in: [MeetingStatus.PENDING, MeetingStatus.RESCHEDULE_REQUESTED, MeetingStatus.PENDING_LINK],
            },
        })
            .populate('organizerId', 'name email avatar')
            .populate('projectId', 'name status')
            .populate('taskId', 'title taskNumber ticketId')
            .sort({ scheduledStartAt: 1 })
            .lean();

        // Attach participant detail
        const allParticipantsForMeetings = await MeetingParticipant.find({
            meetingId: { $in: meetings.map((m) => m._id) },
        })
            .populate('userId', 'name email avatar role')
            .lean();

        const participantMap = new Map<string, any[]>();
        allParticipantsForMeetings.forEach((p) => {
            const mId = p.meetingId.toString();
            if (!participantMap.has(mId)) {
                participantMap.set(mId, []);
            }
            participantMap.get(mId)!.push(p);
        });

        return meetings.map((m) => ({
            ...m,
            participants: participantMap.get(m._id.toString()) || [],
        }));
    }
}
