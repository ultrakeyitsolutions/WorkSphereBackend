import crypto from 'crypto';
import { CalendarOAuthService } from '../calendar/calendar-oauth.service';
import CalendarEvent from '../calendar/calendar-event.model';
import { EntitlementService } from '../../services/entitlement.service';
import { TeamAccessService } from '../manager/services/team-access.service';
import User from '../users/user.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../companyadmin/projects/project.model';
import { AppError } from '../../utils/AppError';
import {
    CreateInstantMeetingDTO,
    MeetingSummaryMetrics,
    MeetingReportsQuery,
    MeetingReportResponse,
    MeetingType,
} from './meeting.types';
import { Types } from 'mongoose';
import { Meeting } from './models/meeting.model';
import { MeetingParticipant } from './models/meeting-participant.model';
import { MeetingScheduleHistory } from './models/meeting-schedule-history.model';
import { MeetingNotificationService } from './meeting-notification.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import {
    MeetingStatus,
    ParticipantRole,
    ParticipantResponseStatus,
    RescheduleStatus,
    MeetingListQuery,
} from './meeting.types';
import { MEETING_CONFIG } from './meeting.constants';

export class MeetingService {
    /**
     * Accept a meeting invitation
     */
    public static async acceptMeeting(
        meetingId: string,
        userId: string,
        companyId: string,
        note?: string | null,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        if (
            meeting.status === MeetingStatus.CANCELLED ||
            meeting.status === MeetingStatus.REJECTED ||
            meeting.status === MeetingStatus.COMPLETED
        ) {
            const err: any = new Error(`Cannot accept meeting in ${meeting.status} state`);
            err.statusCode = 400;
            throw err;
        }

        const participant = await MeetingParticipant.findOne({ meetingId: meeting._id, userId: userObjectId, companyId: companyObjectId });

        if (!participant) {
            const err: any = new Error('You are not a participant of this meeting');
            err.statusCode = 403;
            throw err;
        }

        // Idempotent: If already accepted, return existing state
        if (participant.responseStatus === ParticipantResponseStatus.ACCEPTED) {
            return { meeting, participant, alreadyAccepted: true };
        }

        // Update participant response
        participant.responseStatus = ParticipantResponseStatus.ACCEPTED;
        participant.responseAt = new Date();
        participant.rescheduleRequested = false;
        participant.rescheduleReason = null;
        await participant.save();

        // Check if all REQUIRED participants have accepted
        const allParticipants = await MeetingParticipant.find({ meetingId: meeting._id });

        const requiredParticipants = allParticipants.filter(
            (p) => p.role === ParticipantRole.REQUIRED || p.role === ParticipantRole.ORGANIZER
        );

        const allRequiredAccepted = requiredParticipants.every(
            (p) => p.responseStatus === ParticipantResponseStatus.ACCEPTED
        );

        let statusChanged = false;
        if (allRequiredAccepted && meeting.status === MeetingStatus.PENDING) {
            meeting.status = MeetingStatus.ACCEPTED;
            meeting.acceptedAt = new Date();
            await meeting.save();
            statusChanged = true;
        }

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_ACCEPTED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                allAccepted: allRequiredAccepted,
                note: note || '',
            },
            success: true,
            description: `Participant accepted meeting: "${meeting.title}"`,
            req,
        });

        // Notify organizer & participants
        const recipientIds = allParticipants
            .map((p) => p.userId.toString())
            .filter((id) => id !== userId);

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_ACCEPTED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds,
            meetingTitle: meeting.title,
            scheduledStartAt: meeting.scheduledStartAt,
            metadata: {
                allAccepted: allRequiredAccepted,
                status: meeting.status,
            },
        });

        return {
            meeting,
            participant,
            allRequiredAccepted,
            statusChanged,
        };
    }

    /**
     * Reject a meeting invitation
     */
    public static async rejectMeeting(
        meetingId: string,
        userId: string,
        companyId: string,
        reason: string,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const participant = await MeetingParticipant.findOne({ meetingId: meeting._id, userId: userObjectId, companyId: companyObjectId });

        if (!participant) {
            const err: any = new Error('You are not a participant of this meeting');
            err.statusCode = 403;
            throw err;
        }

        participant.responseStatus = ParticipantResponseStatus.DECLINED;
        participant.declineReason = reason;
        participant.responseAt = new Date();
        await participant.save();

        // If organizer or if required participant declines, mark meeting as REJECTED
        meeting.status = MeetingStatus.REJECTED;
        meeting.rejectedAt = new Date();
        meeting.rejectionReason = reason;
        await meeting.save();

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_REJECTED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                reason,
            },
            success: true,
            description: `Meeting rejected: "${meeting.title}" - Reason: ${reason}`,
            req,
        });

        // Notify Organizer & all other participants
        const allParticipants = await MeetingParticipant.find({ meetingId: meeting._id });
        const recipientIds = allParticipants
            .map((p) => p.userId.toString())
            .filter((id) => id !== userId);

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_REJECTED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds,
            meetingTitle: meeting.title,
            reason,
        });

        return { meeting, participant };
    }

    /**
     * Request a meeting reschedule
     */
    public static async requestReschedule(
        meetingId: string,
        userId: string,
        companyId: string,
        proposedStartAtStr: string | Date,
        durationMinutes?: number,
        reason?: string,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const participant = await MeetingParticipant.findOne({ meetingId: meeting._id, userId: userObjectId, companyId: companyObjectId });

        if (!participant) {
            const err: any = new Error('You are not authorized to reschedule this meeting');
            err.statusCode = 403;
            throw err;
        }

        const proposedStartAt = new Date(proposedStartAtStr);
        const duration = durationMinutes || meeting.durationMinutes || 30;
        const proposedEndAt = new Date(proposedStartAt.getTime() + duration * 60 * 1000);

        if (isNaN(proposedStartAt.getTime())) {
            const err: any = new Error('Invalid proposed start date/time');
            err.statusCode = 400;
            throw err;
        }

        // Create Reschedule History Record
        const history = await MeetingScheduleHistory.create({
            ...meetingIdQuery,
            companyId: companyObjectId,
            previousStartAt: meeting.scheduledStartAt,
            previousEndAt: meeting.scheduledEndAt,
            proposedStartAt,
            proposedEndAt,
            durationMinutes: duration,
            requestedBy: userObjectId,
            reason: reason || null,
            status: RescheduleStatus.PENDING,
        });

        // Update Meeting status to RESCHEDULE_REQUESTED
        meeting.status = MeetingStatus.RESCHEDULE_REQUESTED;
        await meeting.save();

        // Update Participant record
        participant.rescheduleRequested = true;
        participant.rescheduleReason = reason || null;
        participant.responseStatus = ParticipantResponseStatus.RESCHEDULE_REQUESTED;
        await participant.save();

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_RESCHEDULE_REQUESTED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                proposedStartAt,
                durationMinutes: duration,
                reason: reason || '',
            },
            success: true,
            description: `Reschedule requested for meeting: "${meeting.title}"`,
            req,
        });

        // Notify other participants
        const allParticipants = await MeetingParticipant.find({ meetingId: meeting._id });
        const recipientIds = allParticipants
            .map((p) => p.userId.toString())
            .filter((id) => id !== userId);

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_RESCHEDULE_REQUESTED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds,
            meetingTitle: meeting.title,
            proposedStartAt,
            reason: reason || undefined,
        });

        return { meeting, history, participant };
    }

    /**
     * Accept a proposed reschedule
     */
    public static async acceptReschedule(
        meetingId: string,
        userId: string,
        companyId: string,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const latestHistory = await MeetingScheduleHistory.findOne({
            ...meetingIdQuery,
            status: RescheduleStatus.PENDING,
        }).sort({ createdAt: -1 });

        if (!latestHistory) {
            const err: any = new Error('No pending reschedule request found for this meeting');
            err.statusCode = 400;
            throw err;
        }

        // Apply new schedule to meeting
        meeting.scheduledStartAt = latestHistory.proposedStartAt;
        meeting.scheduledEndAt = latestHistory.proposedEndAt;
        meeting.durationMinutes = latestHistory.durationMinutes;
        meeting.status = MeetingStatus.ACCEPTED;
        meeting.currentVersion = (meeting.currentVersion || 1) + 1;
        meeting.reminded15Min = false;
        meeting.reminded5Min = false;
        await meeting.save();

        // Update history status
        latestHistory.status = RescheduleStatus.ACCEPTED;
        latestHistory.approvedBy = userObjectId;
        await latestHistory.save();

        // Reset all participants to ACCEPTED
        await MeetingParticipant.updateMany(
            { meetingId: meeting._id },
            {
                $set: {
                    responseStatus: ParticipantResponseStatus.ACCEPTED,
                    rescheduleRequested: false,
                    rescheduleReason: null,
                    responseAt: new Date(),
                },
            }
        );

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_RESCHEDULE_ACCEPTED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                newStartAt: meeting.scheduledStartAt,
            },
            success: true,
            description: `Meeting reschedule approved for: "${meeting.title}"`,
            req,
        });

        // Notify all participants
        const allParticipants = await MeetingParticipant.find({ meetingId: meeting._id });
        const recipientIds = allParticipants.map((p) => p.userId.toString());

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_RESCHEDULE_ACCEPTED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds,
            meetingTitle: meeting.title,
            scheduledStartAt: meeting.scheduledStartAt,
        });

        return { meeting, history: latestHistory };
    }

    /**
     * Reject a proposed reschedule
     */
    public static async rejectReschedule(
        meetingId: string,
        userId: string,
        companyId: string,
        reason?: string | null,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const latestHistory = await MeetingScheduleHistory.findOne({
            ...meetingIdQuery,
            status: RescheduleStatus.PENDING,
        }).sort({ createdAt: -1 });

        if (!latestHistory) {
            const err: any = new Error('No pending reschedule request found');
            err.statusCode = 400;
            throw err;
        }

        latestHistory.status = RescheduleStatus.REJECTED;
        await latestHistory.save();

        // Restore meeting status back to ACCEPTED or PENDING
        meeting.status = MeetingStatus.ACCEPTED;
        await meeting.save();

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_RESCHEDULE_REJECTED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                reason: reason || '',
            },
            success: true,
            description: `Meeting reschedule rejected for: "${meeting.title}"`,
            req,
        });

        // Notify the user who requested the reschedule
        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_RESCHEDULE_REJECTED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds: [latestHistory.requestedBy.toString()],
            meetingTitle: meeting.title,
            reason: reason || undefined,
        });

        return { meeting, history: latestHistory };
    }

    /**
     * Propose an alternative reschedule time
     */
    public static async proposeReschedule(
        meetingId: string,
        userId: string,
        companyId: string,
        proposedStartAtStr: string | Date,
        durationMinutes?: number,
        reason?: string,
        req?: any
    ): Promise<any> {
        // Cancel previous pending proposals
        await MeetingScheduleHistory.updateMany(
            {
                meetingId: new Types.ObjectId(meetingId),
                status: RescheduleStatus.PENDING,
            },
            { $set: { status: RescheduleStatus.CANCELLED } }
        );

        return this.requestReschedule(
            meetingId,
            userId,
            companyId,
            proposedStartAtStr,
            durationMinutes,
            reason,
            req
        );
    }

    /**
     * Cancel a meeting
     */
    public static async cancelMeeting(
        meetingId: string,
        userId: string,
        companyId: string,
        userRole: string,
        reason: string,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const isOrganizer = meeting.organizerId.toString() === userId;
        const isAdmin =
            userRole === 'COMPANY_ADMIN' ||
            userRole === 'Admin' ||
            userRole === 'SUPER_ADMIN';

        if (!isOrganizer && !isAdmin) {
            const err: any = new Error('Only the organizer or an administrator can cancel this meeting');
            err.statusCode = 403;
            throw err;
        }

        meeting.status = MeetingStatus.CANCELLED;
        meeting.cancelledAt = new Date();
        meeting.cancellationReason = reason;
        await meeting.save();

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_CANCELLED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                reason,
            },
            success: true,
            description: `Meeting cancelled: "${meeting.title}" - Reason: ${reason}`,
            req,
        });

        // Notify all participants
        const allParticipants = await MeetingParticipant.find({ meetingId: meeting._id });
        const recipientIds = allParticipants
            .map((p) => p.userId.toString())
            .filter((id) => id !== userId);

        MeetingNotificationService.sendMeetingNotification({
            type: 'MEETING_CANCELLED',
            companyId,
            actorId: userId,
            meetingId: meeting._id.toString(),
            recipientIds,
            meetingTitle: meeting.title,
            reason,
        });

        return { meeting };
    }

    /**
     * Join a meeting (Immediate Join with window validation)
     */
    public static async joinMeeting(
        meetingId: string,
        userId: string,
        companyId: string,
        userRole: string,
        req?: any
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        if (
            meeting.status === MeetingStatus.CANCELLED ||
            meeting.status === MeetingStatus.REJECTED ||
            meeting.status === MeetingStatus.EXPIRED
        ) {
            const err: any = new Error(`Cannot join meeting in ${meeting.status} state`);
            err.statusCode = 400;
            throw err;
        }

        const isParticipant = await MeetingParticipant.findOne({ meetingId: meeting._id, userId: userObjectId });

        const isAdmin =
            userRole === 'COMPANY_ADMIN' ||
            userRole === 'Admin' ||
            userRole === 'SUPER_ADMIN';

        if (!isParticipant && !isAdmin) {
            const err: any = new Error('You are not authorized to join this meeting');
            err.statusCode = 403;
            throw err;
        }

        // Validate Join Window (-15 minutes from scheduledStartAt to scheduledEndAt)
        const now = Date.now();
        const startMs = new Date(meeting.scheduledStartAt).getTime();
        const endMs = new Date(meeting.scheduledEndAt).getTime();
        const earlyJoinMs = MEETING_CONFIG.EARLY_JOIN_MINUTES * 60 * 1000;

        if (now < startMs - earlyJoinMs) {
            const err: any = new Error(
                `Too early to join. Meeting opens ${MEETING_CONFIG.EARLY_JOIN_MINUTES} minutes before scheduled start time.`
            );
            err.statusCode = 400;
            throw err;
        }

        if (now > endMs) {
            // Meeting is past scheduled end time; mark completed if still active
            if (meeting.status === MeetingStatus.IN_PROGRESS || meeting.status === MeetingStatus.ACCEPTED) {
                meeting.status = MeetingStatus.COMPLETED;
                meeting.completedAt = new Date();
                await meeting.save();
            }
        } else {
            // Mark meeting IN_PROGRESS if currently ACCEPTED/RESCHEDULED
            if (
                meeting.status === MeetingStatus.ACCEPTED ||
                meeting.status === MeetingStatus.RESCHEDULED ||
                meeting.status === MeetingStatus.PENDING
            ) {
                meeting.status = MeetingStatus.IN_PROGRESS;
                await meeting.save();
            }
        }

        // Record participant join timestamp
        if (isParticipant) {
            isParticipant.joinedAt = new Date();
            await isParticipant.save();
        }

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_JOINED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
            },
            success: true,
            description: `User joined meeting: "${meeting.title}"`,
            req,
        });

        // On-the-fly room recovery if provider was selected but link is empty
        if (!meeting.meetingLink && (meeting.meetingProvider === 'google_meet' || meeting.meetingProvider === 'ms_teams')) {
            try {
                const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
                    companyId,
                    meeting.organizerId.toString(),
                    meeting.meetingProvider as any,
                    {
                        title: meeting.title,
                        description: meeting.description || meeting.agenda,
                        startTime: meeting.scheduledStartAt,
                        endTime: meeting.scheduledEndAt,
                    }
                );
                if (meetingDetails.meetingUrl) {
                    meeting.meetingLink = meetingDetails.meetingUrl;
                    meeting.externalMeetingId = meetingDetails.externalEventId || null;
                    await meeting.save();

                    if (meeting.calendarEventId) {
                        await CalendarEvent.findByIdAndUpdate(meeting.calendarEventId, {
                            meetingUrl: meetingDetails.meetingUrl,
                            externalEventId: meetingDetails.externalEventId || null,
                            externalProviderData: meetingDetails.externalProviderData || null,
                        });
                    }
                }
            } catch (repairErr: any) {
                console.warn('[joinMeeting] On-the-fly room generation attempt failed:', repairErr.message);
            }
        }

        return {
            meetingId: meeting.meetingId,
            id: meeting._id.toString(),
            meetingLink: meeting.meetingLink || null,
            scheduledStartAt: meeting.scheduledStartAt,
            scheduledEndAt: meeting.scheduledEndAt,
            status: meeting.status,
        };
    }

    /**
     * Get meeting details by ID
     */
    public static async getMeetingById(
        meetingId: string,
        userId: string,
        companyId: string,
        userRole: string
    ): Promise<any> {
        const isMeetingObjId = Types.ObjectId.isValid(meetingId);
        const meetingIdQuery = isMeetingObjId ? { $or: [{ _id: new Types.ObjectId(meetingId) }, { meetingId }] } : { meetingId };
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            ...meetingIdQuery,
            companyId: companyObjectId,
        })
            .populate('organizerId', 'name email avatar role')
            .populate('projectId', 'name status type')
            .populate('taskId', 'title taskNumber ticketId')
            .lean();

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const [participants, scheduleHistory] = await Promise.all([
            MeetingParticipant.find({ meetingId: meeting._id })
                .populate('userId', 'name email avatar role')
                .lean(),
            MeetingScheduleHistory.find({ meetingId: meeting._id })
                .populate('requestedBy', 'name email')
                .populate('approvedBy', 'name email')
                .sort({ createdAt: -1 })
                .lean(),
        ]);

        const isOrganizer = meeting.organizerId?._id?.toString() === userId;
        const isParticipant = participants.some(
            (p) => p.userId?._id?.toString() === userId
        );
        const isAdmin =
            userRole === 'COMPANY_ADMIN' ||
            userRole === 'Admin' ||
            userRole === 'SUPER_ADMIN';

        if (!isOrganizer && !isParticipant && !isAdmin) {
            const err: any = new Error('You are not authorized to view this meeting');
            err.statusCode = 403;
            throw err;
        }

        return {
            ...meeting,
            participants,
            scheduleHistory,
        };
    }

    /**
     * List meetings organized by current user
     */
    public static async getMyMeetings(
        companyId: string,
        userId: string,
        query: MeetingListQuery
    ): Promise<{ meetings: any[]; total: number; page: number; limit: number }> {
        const page = query.page || MEETING_CONFIG.DEFAULT_PAGE;
        const limit = query.limit || MEETING_CONFIG.DEFAULT_LIMIT;
        const skip = (page - 1) * limit;

        const filter: any = {
            companyId: new Types.ObjectId(companyId),
            organizerId: new Types.ObjectId(userId),
        };

        if (query.status) {
            filter.status = query.status;
        }
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            filter.projectId = new Types.ObjectId(query.projectId);
        }
        if (query.taskId && Types.ObjectId.isValid(query.taskId)) {
            filter.taskId = new Types.ObjectId(query.taskId);
        }
        if (query.dateFrom || query.dateTo) {
            filter.scheduledStartAt = {};
            if (query.dateFrom) filter.scheduledStartAt.$gte = new Date(query.dateFrom);
            if (query.dateTo) filter.scheduledStartAt.$lte = new Date(query.dateTo);
        }
        if (query.search) {
            filter.$or = [
                { title: { $regex: query.search, $options: 'i' } },
                { agenda: { $regex: query.search, $options: 'i' } },
            ];
        }

        const [meetings, total] = await Promise.all([
            Meeting.find(filter)
                .populate('organizerId', 'name email avatar')
                .populate('projectId', 'name')
                .populate('taskId', 'title')
                .sort({ scheduledStartAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Meeting.countDocuments(filter),
        ]);

        return { meetings, total, page, limit };
    }

    /**
     * List meetings assigned/invited to current user
     */
    public static async getAssignedMeetings(
        companyId: string,
        userId: string,
        query: MeetingListQuery
    ): Promise<{ meetings: any[]; total: number; page: number; limit: number }> {
        const page = query.page || MEETING_CONFIG.DEFAULT_PAGE;
        const limit = query.limit || MEETING_CONFIG.DEFAULT_LIMIT;
        const skip = (page - 1) * limit;

        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        // Find meetings where this user is participant (not organizer)
        const participantDocs = await MeetingParticipant.find({
            userId: userObjectId,
            companyId: companyObjectId,
            role: { $ne: ParticipantRole.ORGANIZER },
        }).lean();

        const meetingIds = participantDocs.map((p) => p.meetingId);

        const filter: any = {
            _id: { $in: meetingIds },
            companyId: companyObjectId,
        };

        if (query.status) {
            filter.status = query.status;
        }
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            filter.projectId = new Types.ObjectId(query.projectId);
        }
        if (query.dateFrom || query.dateTo) {
            filter.scheduledStartAt = {};
            if (query.dateFrom) filter.scheduledStartAt.$gte = new Date(query.dateFrom);
            if (query.dateTo) filter.scheduledStartAt.$lte = new Date(query.dateTo);
        }
        if (query.search) {
            filter.$or = [
                { title: { $regex: query.search, $options: 'i' } },
                { agenda: { $regex: query.search, $options: 'i' } },
            ];
        }

        const [meetings, total] = await Promise.all([
            Meeting.find(filter)
                .populate('organizerId', 'name email avatar')
                .populate('projectId', 'name')
                .populate('taskId', 'title')
                .sort({ scheduledStartAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Meeting.countDocuments(filter),
        ]);

        return { meetings, total, page, limit };
    }

    /**
     * List company-wide meetings (for Company Admin)
     */
    public static async getCompanyMeetings(
        companyId: string,
        query: MeetingListQuery
    ): Promise<{ meetings: any[]; total: number; page: number; limit: number }> {
        const page = query.page || MEETING_CONFIG.DEFAULT_PAGE;
        const limit = query.limit || MEETING_CONFIG.DEFAULT_LIMIT;
        const skip = (page - 1) * limit;

        const filter: any = {
            companyId: new Types.ObjectId(companyId),
        };

        if (query.status) {
            filter.status = query.status;
        }
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            filter.projectId = new Types.ObjectId(query.projectId);
        }
        if (query.dateFrom || query.dateTo) {
            filter.scheduledStartAt = {};
            if (query.dateFrom) filter.scheduledStartAt.$gte = new Date(query.dateFrom);
            if (query.dateTo) filter.scheduledStartAt.$lte = new Date(query.dateTo);
        }
        if (query.search) {
            filter.$or = [
                { title: { $regex: query.search, $options: 'i' } },
                { agenda: { $regex: query.search, $options: 'i' } },
            ];
        }

        const [meetings, total] = await Promise.all([
            Meeting.find(filter)
                .populate('organizerId', 'name email avatar')
                .populate('projectId', 'name')
                .populate('taskId', 'title')
                .sort({ scheduledStartAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Meeting.countDocuments(filter),
        ]);

        return { meetings, total, page, limit };
    }

    /**
     * List upcoming meetings for current user (today, tomorrow, future)
     */
    public static async getUpcomingMeetings(
        companyId: string,
        userId: string
    ): Promise<{ today: any[]; tomorrow: any[]; upcoming: any[] }> {
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const participantDocs = await MeetingParticipant.find({
            userId: userObjectId,
            companyId: companyObjectId,
            responseStatus: { $ne: ParticipantResponseStatus.DECLINED },
        }).lean();

        const meetingIds = participantDocs.map((p) => p.meetingId);

        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setUTCHours(0, 0, 0, 0);

        const endOfToday = new Date(now);
        endOfToday.setUTCHours(23, 59, 59, 999);

        const startOfTomorrow = new Date(endOfToday.getTime() + 1);
        const endOfTomorrow = new Date(startOfTomorrow);
        endOfTomorrow.setUTCHours(23, 59, 59, 999);

        const activeStatuses = [
            MeetingStatus.PENDING,
            MeetingStatus.ACCEPTED,
            MeetingStatus.RESCHEDULED,
            MeetingStatus.IN_PROGRESS,
        ];

        const allUpcoming = await Meeting.find({
            _id: { $in: meetingIds },
            companyId: companyObjectId,
            status: { $in: activeStatuses },
            scheduledEndAt: { $gte: now },
        })
            .populate('organizerId', 'name email avatar')
            .populate('projectId', 'name')
            .sort({ scheduledStartAt: 1 })
            .lean();

        const today: any[] = [];
        const tomorrow: any[] = [];
        const upcoming: any[] = [];

        allUpcoming.forEach((m) => {
            const start = new Date(m.scheduledStartAt);
            if (start >= startOfToday && start <= endOfToday) {
                today.push(m);
            } else if (start >= startOfTomorrow && start <= endOfTomorrow) {
                tomorrow.push(m);
            } else {
                upcoming.push(m);
            }
        });

        return { today, tomorrow, upcoming };
    }

    /**
     * List past / historical meetings (COMPLETED, CANCELLED, REJECTED, EXPIRED)
     */
    public static async getMeetingHistory(
        companyId: string,
        userId: string,
        query: MeetingListQuery
    ): Promise<{ meetings: any[]; total: number; page: number; limit: number }> {
        const page = query.page || MEETING_CONFIG.DEFAULT_PAGE;
        const limit = query.limit || MEETING_CONFIG.DEFAULT_LIMIT;
        const skip = (page - 1) * limit;

        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const participantDocs = await MeetingParticipant.find({
            userId: userObjectId,
            companyId: companyObjectId,
        }).lean();

        const meetingIds = participantDocs.map((p) => p.meetingId);

        const historicalStatuses = [
            MeetingStatus.COMPLETED,
            MeetingStatus.CANCELLED,
            MeetingStatus.REJECTED,
            MeetingStatus.EXPIRED,
        ];

        const filter: any = {
            _id: { $in: meetingIds },
            companyId: companyObjectId,
            status: { $in: historicalStatuses },
        };

        if (query.status && historicalStatuses.includes(query.status as MeetingStatus)) {
            filter.status = query.status;
        }

        const [meetings, total] = await Promise.all([
            Meeting.find(filter)
                .populate('organizerId', 'name email avatar')
                .populate('projectId', 'name')
                .sort({ scheduledStartAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Meeting.countDocuments(filter),
        ]);

        return { meetings, total, page, limit };
    }

    /**
     * Create an Instant Meeting (1-Click Google Meet / MS Teams room with quota deduction & sync)
     */
    public static async createInstantMeeting(
        companyId: string,
        userId: string,
        dto: CreateInstantMeetingDTO,
        req?: any
    ): Promise<any> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);

        // 1. Check feature entitlement
        const featureKey = dto.provider === 'google_meet' ? 'GOOGLE_MEET' : 'MS_TEAMS';
        const hasFeature = await EntitlementService.hasFeature(companyId, featureKey);
        if (!hasFeature) {
            throw AppError.forbidden(`${dto.provider === 'google_meet' ? 'Google Meet' : 'Microsoft Teams'} is not included in your current subscription plan.`);
        }

        // 2. Check quick meetings quota
        const qmLimits = await EntitlementService.getQuickMeetingLimits(companyId);
        if (!qmLimits.enabled) {
            throw AppError.forbidden('Quick Meetings feature is not enabled for your company plan.');
        }

        if (!qmLimits.isUnlimited) {
            const now = new Date();
            const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
            const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

            const usedThisMonth = await Meeting.countDocuments({
                companyId: cId,
                meetingType: MeetingType.QUICK,
                createdAt: { $gte: startOfMonth, $lte: endOfMonth },
            });

            if (usedThisMonth >= qmLimits.monthlyLimit) {
                const err: any = new Error('QUICK_MEETING_LIMIT_REACHED');
                err.statusCode = 403;
                err.details = `You have reached your monthly limit of ${qmLimits.monthlyLimit} quick meetings for your plan. Please upgrade to unlock unlimited instant rooms.`;
                throw err;
            }
        }

        const organizerDoc = await User.findById(uId).select('name email avatar role').lean();
        if (!organizerDoc) throw AppError.notFound('Organizer user account not found');

        const organizerName = organizerDoc.name || organizerDoc.email.split('@')[0];
        const organizerEmail = organizerDoc.email;
        const durationMinutes = dto.durationMinutes || 30;
        const startAt = new Date();
        const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
        const title = dto.title?.trim() || `Instant Sync with ${organizerName}`;

        let projectName: string | undefined;
        let projectObjId: Types.ObjectId | null = null;
        const participantMap = new Map<string, any>();

        participantMap.set(userId.toString(), {
            userId: uId,
            name: organizerName,
            email: organizerEmail,
            avatar: (organizerDoc as any).avatar || null,
            role: (organizerDoc.role as any)?.name || 'Organizer',
            designation: 'Organizer',
            status: 'organizer',
            isCoOrganizer: false,
            respondedAt: new Date(),
        });

        // Resolve Project & Project Members if projectId provided
        if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
            const project = await Project.findOne({ _id: dto.projectId, companyId: cId }).select('name').lean();
            if (project) {
                projectName = project.name;
                projectObjId = project._id as Types.ObjectId;

                const [teamMembers, inCharges] = await Promise.all([
                    ProjectTeamMember.find({ projectId: projectObjId }).populate('userId', 'name email avatar role').lean(),
                    ProjectInCharge.find({ projectId: projectObjId }).populate('userId', 'name email avatar role').lean(),
                ]);

                for (const tm of teamMembers) {
                    const u = tm.userId as any;
                    if (u && u._id && !participantMap.has(u._id.toString())) {
                        participantMap.set(u._id.toString(), {
                            userId: u._id,
                            name: u.name || u.email?.split('@')[0],
                            email: u.email,
                            avatar: u.avatar || null,
                            role: (u.role as any)?.name || 'Member',
                            designation: 'Participant',
                            status: 'accepted',
                            isCoOrganizer: false,
                        });
                    }
                }

                for (const ic of inCharges) {
                    const u = ic.userId as any;
                    if (u && u._id && !participantMap.has(u._id.toString())) {
                        participantMap.set(u._id.toString(), {
                            userId: u._id,
                            name: u.name || u.email?.split('@')[0],
                            email: u.email,
                            avatar: u.avatar || null,
                            role: (u.role as any)?.name || 'In Charge',
                            designation: 'Co-Organizer',
                            status: 'accepted',
                            isCoOrganizer: true,
                        });
                    }
                }
            }
        }

        // Resolve explicit participant IDs if provided
        if (dto.participantIds && dto.participantIds.length > 0) {
            const explicitUsers = await User.find({
                _id: { $in: dto.participantIds },
                companyId: cId,
            }).select('name email avatar role').lean();

            for (const u of explicitUsers) {
                if (u && u._id && !participantMap.has(u._id.toString())) {
                    participantMap.set(u._id.toString(), {
                        userId: u._id,
                        name: u.name || u.email?.split('@')[0],
                        email: u.email,
                        avatar: (u as any).avatar || null,
                        role: ((u as any).role as any)?.name || 'Member',
                        designation: 'Participant',
                        status: 'accepted',
                        isCoOrganizer: false,
                    });
                }
            }
        }

        const participants = Array.from(participantMap.values());
        const participantEmails = participants.map((p) => p.email).filter(Boolean);

        // Generate Video Conference Details via CalendarOAuthService
        const meetingDetails = await CalendarOAuthService.generateMeetingDetails(
            companyId,
            userId,
            dto.provider,
            {
                title,
                description: dto.description || `Instant meeting generated via WorkSphere Meetings Hub${projectName ? ` for project ${projectName}` : ''}`,
                startTime: startAt,
                endTime: endAt,
                timeZone: 'Asia/Kolkata',
                participantEmails,
            }
        );

        if (!meetingDetails.meetingUrl) {
            throw AppError.badRequest(`Could not generate conference URL with provider ${dto.provider}. Ensure your account is connected in Calendar Integrations.`);
        }

        const shortHash = crypto.randomBytes(4).toString('hex');
        const meetingIdStr = `ws-meet-${Date.now().toString(36)}-${shortHash}`;

        // Create Canonical Meeting Document
        const meeting = await Meeting.create({
            meetingId: meetingIdStr,
            companyId: cId,
            organizerId: uId,
            title,
            agenda: dto.description || 'Instant Collaboration Sync',
            description: dto.description || null,
            projectId: projectObjId,
            meetingType: MeetingType.QUICK,
            meetingLink: meetingDetails.meetingUrl,
            meetingProvider: dto.provider,
            externalMeetingId: meetingDetails.externalEventId || null,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes,
            timezone: 'Asia/Kolkata',
            status: MeetingStatus.IN_PROGRESS,
            currentVersion: 1,
        });

        // Create Participant Records in MeetingParticipant
        const participantDocs = participants.map((p) => ({
            meetingId: meeting._id,
            userId: p.userId,
            companyId: cId,
            role: p.isCoOrganizer ? ParticipantRole.REQUIRED : p.status === 'organizer' ? ParticipantRole.ORGANIZER : ParticipantRole.REQUIRED,
            responseStatus: ParticipantResponseStatus.ACCEPTED,
            responseAt: new Date(),
            joinedAt: p.userId.toString() === userId ? new Date() : null,
        }));

        await MeetingParticipant.insertMany(participantDocs);

        // Create Matching CalendarEvent (Bridge synchronization)
        let calendarEvent: any = null;
        try {
            calendarEvent = await CalendarEvent.create({
                companyId: cId,
                title,
                description: dto.description || `Instant meeting generated via WorkSphere Meetings Hub${projectName ? ` for project ${projectName}` : ''}`,
                startTime: startAt,
                endTime: endAt,
                allDay: false,
                timeZone: 'Asia/Kolkata',
                organizer: {
                    userId: uId,
                    name: organizerName,
                    email: organizerEmail,
                    avatar: (organizerDoc as any).avatar || null,
                },
                coOrganizers: participants.filter((p) => p.isCoOrganizer).map((p) => p.userId),
                participants,
                meetingType: 'video',
                provider: dto.provider,
                meetingUrl: meetingDetails.meetingUrl,
                externalEventId: meetingDetails.externalEventId || null,
                externalProviderData: meetingDetails.externalProviderData || undefined,
                agenda: [],
                reminderMinutes: 15,
                recurrence: 'none',
                projectId: projectObjId,
                projectName,
                color: '#F97316',
                isQuickMeeting: true,
            });

            meeting.calendarEventId = calendarEvent._id as Types.ObjectId;
            await meeting.save();
        } catch (calErr: any) {
            console.error('[Instant Meeting] CalendarEvent synchronization warning:', calErr.message);
        }

        // Audit Log
        await AuditLogService.log({
            action: AuditAction.MEETING_CREATED,
            actorId: userId,
            companyId,
            metadata: {
                meetingId: meeting._id.toString(),
                customMeetingId: meetingIdStr,
                provider: dto.provider,
                meetingUrl: meetingDetails.meetingUrl,
                participantCount: participants.length,
            },
            success: true,
            description: `Instant meeting launched: "${title}" via ${dto.provider}`,
            req,
        });

        // Notifications to all other participants
        const recipientIds = participants
            .map((p) => p.userId?.toString())
            .filter((id) => id && id !== userId);

        if (recipientIds.length > 0) {
            const isAdmin = ['ADMIN', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(((organizerDoc.role as any)?.name || '').toUpperCase());
            const actionUrl = isAdmin
                ? `/companyadmin/pages/meetings?meetingId=${meeting._id}&tab=inbox`
                : `/main/meetings?meetingId=${meeting._id}&tab=inbox`;

            MeetingNotificationService.sendMeetingNotification({
                type: 'MEETING_REQUESTED',
                companyId,
                actorId: userId,
                meetingId: meeting._id.toString(),
                recipientIds,
                meetingTitle: title,
                projectName,
                agenda: meeting.agenda,
                scheduledStartAt: startAt,
                meetingLink: meetingDetails.meetingUrl,
                actionUrl,
                metadata: {
                    actorName: organizerName,
                    isInstant: true,
                    provider: dto.provider,
                },
            });
        }

        return {
            id: meeting._id.toString(),
            meetingId: meeting.meetingId,
            calendarEventId: calendarEvent ? calendarEvent._id.toString() : null,
            title: meeting.title,
            meetingUrl: meeting.meetingLink,
            provider: dto.provider,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            durationMinutes,
            projectName,
            participantsCount: participants.length,
        };
    }

    /**
     * Get Compact Summary Metrics for Meetings Hub Dashboard
     */
    public static async getSummaryMetrics(
        companyId: string,
        userId: string,
        userRole: string
    ): Promise<MeetingSummaryMetrics> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);
        const role = (userRole || '').toUpperCase();
        const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(role);
        const isManager = role === 'MANAGER';

        const now = new Date();
        let baseMeetingMatch: any = { companyId: cId };

        if (!isAdmin) {
            if (isManager) {
                const scope = await TeamAccessService.resolveScope(companyId, userId);
                const employeeIds = scope.allAccessibleEmployeeIds || [];
                const projectIds = scope.allAccessibleProjectIds || [];

                const participantDocs = await MeetingParticipant.find({
                    companyId: cId,
                    userId: { $in: [uId, ...employeeIds] },
                }).select('meetingId').lean();

                const participantMeetingIds = participantDocs.map((p) => p.meetingId);

                baseMeetingMatch.$or = [
                    { organizerId: { $in: [uId, ...employeeIds] } },
                    { projectId: { $in: projectIds } },
                    { _id: { $in: participantMeetingIds } },
                ];
            } else {
                const participantDocs = await MeetingParticipant.find({
                    companyId: cId,
                    userId: uId,
                }).select('meetingId').lean();

                const participantMeetingIds = participantDocs.map((p) => p.meetingId);

                baseMeetingMatch.$or = [
                    { organizerId: uId },
                    { _id: { $in: participantMeetingIds } },
                ];
            }
        }

        const [
            totalMeetings,
            upcomingMeetings,
            pendingInvitations,
            completedMeetingsAgg,
        ] = await Promise.all([
            Meeting.countDocuments(baseMeetingMatch),
            Meeting.countDocuments({
                ...baseMeetingMatch,
                scheduledEndAt: { $gte: now },
                status: {
                    $in: [
                        MeetingStatus.PENDING,
                        MeetingStatus.ACCEPTED,
                        MeetingStatus.RESCHEDULED,
                        MeetingStatus.IN_PROGRESS,
                    ],
                },
            }),
            MeetingParticipant.countDocuments({
                companyId: cId,
                userId: uId,
                responseStatus: ParticipantResponseStatus.PENDING,
            }),
            Meeting.aggregate([
                {
                    $match: {
                        ...baseMeetingMatch,
                        status: MeetingStatus.COMPLETED,
                    },
                },
                {
                    $group: {
                        _id: null,
                        completedCount: { $sum: 1 },
                        totalMinutes: { $sum: '$durationMinutes' },
                    },
                },
            ]),
        ]);

        const completedCount = completedMeetingsAgg[0]?.completedCount || 0;
        const totalMinutes = completedMeetingsAgg[0]?.totalMinutes || 0;
        const totalMeetingHours = Math.round((totalMinutes / 60) * 10) / 10;

        return {
            totalMeetings,
            upcomingMeetings,
            pendingInvitations,
            completedMeetings: completedCount,
            totalMeetingHours,
        };
    }

    /**
     * Get Team Meetings (For Managers and Admins with Team-scoped access)
     */
    public static async getTeamMeetings(
        companyId: string,
        managerId: string,
        userRole: string,
        query: MeetingListQuery
    ): Promise<{ meetings: any[]; total: number; page: number; limit: number }> {
        const cId = new Types.ObjectId(companyId);
        const mId = new Types.ObjectId(managerId);
        const page = query.page || MEETING_CONFIG.DEFAULT_PAGE;
        const limit = query.limit || MEETING_CONFIG.DEFAULT_LIMIT;
        const skip = (page - 1) * limit;

        const role = (userRole || '').toUpperCase();
        const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(role);

        let filter: any = { companyId: cId };

        if (!isAdmin) {
            const scope = await TeamAccessService.resolveScope(companyId, managerId);
            const employeeIds = scope.allAccessibleEmployeeIds || [];
            const projectIds = scope.allAccessibleProjectIds || [];

            const participantDocs = await MeetingParticipant.find({
                companyId: cId,
                userId: { $in: [mId, ...employeeIds] },
            }).select('meetingId').lean();

            const participantMeetingIds = participantDocs.map((p) => p.meetingId);

            filter.$or = [
                { organizerId: { $in: [mId, ...employeeIds] } },
                { projectId: { $in: projectIds } },
                { _id: { $in: participantMeetingIds } },
            ];
        }

        if (query.status && query.status !== 'ALL') {
            filter.status = query.status;
        }
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            filter.projectId = new Types.ObjectId(query.projectId);
        }
        if (query.userId && Types.ObjectId.isValid(query.userId)) {
            filter.organizerId = new Types.ObjectId(query.userId);
        }
        if (query.dateFrom || query.dateTo) {
            filter.scheduledStartAt = {};
            if (query.dateFrom) filter.scheduledStartAt.$gte = new Date(query.dateFrom);
            if (query.dateTo) filter.scheduledStartAt.$lte = new Date(query.dateTo);
        }
        if (query.search) {
            filter.$and = filter.$and || [];
            filter.$and.push({
                $or: [
                    { title: { $regex: query.search, $options: 'i' } },
                    { agenda: { $regex: query.search, $options: 'i' } },
                ],
            });
        }

        const [meetings, total] = await Promise.all([
            Meeting.find(filter)
                .populate('organizerId', 'name email avatar role')
                .populate('projectId', 'name')
                .populate('taskId', 'title')
                .sort({ scheduledStartAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Meeting.countDocuments(filter),
        ]);

        const meetingIds = meetings.map((m) => m._id);
        const participants = await MeetingParticipant.find({
            meetingId: { $in: meetingIds },
        })
            .populate('userId', 'name email avatar role')
            .lean();

        const pMap = new Map<string, any[]>();
        participants.forEach((p) => {
            const id = p.meetingId.toString();
            if (!pMap.has(id)) pMap.set(id, []);
            pMap.get(id)!.push(p);
        });

        const formatted = meetings.map((m) => ({
            ...m,
            participants: pMap.get(m._id.toString()) || [],
        }));

        return { meetings: formatted, total, page, limit };
    }

    /**
     * Get Consolidated Meeting Reports & Analytics
     */
    public static async getMeetingReports(
        companyId: string,
        userId: string,
        userRole: string,
        query: MeetingReportsQuery
    ): Promise<MeetingReportResponse> {
        const cId = new Types.ObjectId(companyId);
        const uId = new Types.ObjectId(userId);
        const role = (userRole || '').toUpperCase();
        const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(role);
        const isManager = role === 'MANAGER';

        const reportType = query.type || (isAdmin ? 'organization' : isManager ? 'team' : 'individual');

        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        const from = query.dateFrom ? new Date(query.dateFrom) : defaultFrom;
        const to = query.dateTo ? new Date(query.dateTo) : now;

        const match: any = {
            companyId: cId,
            scheduledStartAt: { $gte: from, $lte: to },
        };

        if (query.provider && query.provider !== 'ALL') {
            match.meetingProvider = query.provider;
        }
        if (query.status && query.status !== 'ALL') {
            match.status = query.status;
        }
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            match.projectId = new Types.ObjectId(query.projectId);
        }

        if (reportType === 'individual' || (!isAdmin && !isManager)) {
            const pDocs = await MeetingParticipant.find({ companyId: cId, userId: uId }).select('meetingId').lean();
            const mIds = pDocs.map((p) => p.meetingId);
            match.$or = [{ organizerId: uId }, { _id: { $in: mIds } }];
        } else if (reportType === 'team' || isManager) {
            const scope = await TeamAccessService.resolveScope(companyId, userId);
            const employeeIds = scope.allAccessibleEmployeeIds || [];
            const projectIds = scope.allAccessibleProjectIds || [];

            const pDocs = await MeetingParticipant.find({
                companyId: cId,
                userId: { $in: [uId, ...employeeIds] },
            }).select('meetingId').lean();
            const mIds = pDocs.map((p) => p.meetingId);

            match.$or = [
                { organizerId: { $in: [uId, ...employeeIds] } },
                { projectId: { $in: projectIds } },
                { _id: { $in: mIds } },
            ];
        }

        const meetings = await Meeting.find(match)
            .populate('organizerId', 'name email avatar')
            .populate('projectId', 'name')
            .sort({ scheduledStartAt: -1 })
            .lean();

        const meetingIds = meetings.map((m) => m._id);
        const participantDocs = await MeetingParticipant.find({
            meetingId: { $in: meetingIds },
        }).lean();

        const pMap = new Map<string, any[]>();
        participantDocs.forEach((p) => {
            const id = p.meetingId.toString();
            if (!pMap.has(id)) pMap.set(id, []);
            pMap.get(id)!.push(p);
        });

        let totalMinutes = 0;
        let completedCount = 0;
        const providerCounts: Record<string, number> = { google_meet: 0, ms_teams: 0, manual: 0, none: 0 };
        const statusCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = { QUICK: 0, SCHEDULED: 0 };

        const items: any[] = [];

        meetings.forEach((m) => {
            const dur = m.durationMinutes || 30;
            totalMinutes += dur;

            const prov = m.meetingProvider || 'none';
            providerCounts[prov] = (providerCounts[prov] || 0) + 1;

            statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
            if (m.status === MeetingStatus.COMPLETED) {
                completedCount++;
            }

            const mType = m.meetingType || 'SCHEDULED';
            typeCounts[mType] = (typeCounts[mType] || 0) + 1;

            const parts = pMap.get(m._id.toString()) || [];
            const attendedCount = parts.filter((p) => p.joinedAt != null).length;
            const acceptedCount = parts.filter((p) => p.responseStatus === ParticipantResponseStatus.ACCEPTED).length;

            items.push({
                id: m._id.toString(),
                meetingId: m.meetingId,
                title: m.title,
                scheduledStartAt: m.scheduledStartAt,
                scheduledEndAt: m.scheduledEndAt,
                durationMinutes: dur,
                status: m.status,
                provider: prov,
                meetingType: mType,
                organizer: m.organizerId,
                project: m.projectId,
                participantsCount: parts.length,
                attendedCount,
                acceptedCount,
                attendanceRate: parts.length > 0 ? Math.round((attendedCount / parts.length) * 100) : 100,
            });
        });

        const totalMeetings = meetings.length;
        const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
        const avgDuration = totalMeetings > 0 ? Math.round(totalMinutes / totalMeetings) : 0;
        const completedRate = totalMeetings > 0 ? Math.round((completedCount / totalMeetings) * 100) : 0;

        return {
            type: reportType,
            dateRange: { from: from.toISOString(), to: to.toISOString() },
            summary: {
                totalMeetings,
                totalHours,
                avgDurationMinutes: avgDuration,
                completedRate,
            },
            breakdowns: {
                byProvider: providerCounts,
                byStatus: statusCounts,
                byType: typeCounts,
            },
            items: items.slice(0, 50),
        };
    }

}
