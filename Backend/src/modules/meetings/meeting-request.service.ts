import crypto from 'crypto';
import { Types } from 'mongoose';
import { Meeting } from './models/meeting.model';
import { MeetingParticipant } from './models/meeting-participant.model';
import { MeetingValidationService } from './meeting-validation.service';
import { MeetingSchedulingService } from './meeting-scheduling.service';
import { MeetingNotificationService } from './meeting-notification.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import {
    CreateMeetingRequestDTO,
    MeetingStatus,
    MeetingType,
    ParticipantRole,
    ParticipantResponseStatus,
} from './meeting.types';

export class MeetingRequestService {
    /**
     * Create a new Quick Meeting Request
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

        // 6. Generate human-readable Unique Meeting ID
        const shortHash = crypto.randomBytes(4).toString('hex');
        const meetingIdStr = `ws-meet-${Date.now().toString(36)}-${shortHash}`;

        // 7. Persist Meeting Document
        const meeting = await Meeting.create({
            meetingId: meetingIdStr,
            companyId: new Types.ObjectId(companyId),
            organizerId: new Types.ObjectId(requesterId),
            title: dto.title.trim(),
            agenda: dto.agenda.trim(),
            description: dto.description ? dto.description.trim() : null,
            projectId: projectDoc ? projectDoc._id : null,
            taskId: taskDoc ? taskDoc._id : null,
            meetingType: dto.meetingType || MeetingType.QUICK,
            meetingLink: dto.meetingLink || null,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes: duration,
            timezone: dto.timezone || 'UTC',
            status: MeetingStatus.PENDING,
            currentVersion: 1,
        });

        // 8. Create Participant Records (Organizer + Invited Participants)
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

        // 9. Audit Logging
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
            },
            success: true,
            description: `Quick meeting request created: "${meeting.title}" by ${requester.name || requester.email}`,
            req,
        });

        // 10. Centralized Notification Dispatch to all invited participants
        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_REQUESTED',
            companyId,
            actorId: requesterId,
            meetingId: meeting._id.toString(),
            recipientIds: validParticipantIds.map((id) => id.toString()),
            meetingTitle: meeting.title,
            projectName: projectDoc ? projectDoc.name : undefined,
            agenda: meeting.agenda,
            scheduledStartAt: startAt,
            meetingLink: meeting.meetingLink || undefined,
            actionUrl: `/companyadmin/quick-meetings?meetingId=${meeting._id}`,
            metadata: {
                actorName: requester.name || requester.email,
                hasConflict: conflictResult.hasConflict,
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
                $in: [MeetingStatus.PENDING, MeetingStatus.RESCHEDULE_REQUESTED],
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
