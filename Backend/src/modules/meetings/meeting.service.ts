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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
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

        const participant = await MeetingParticipant.findOne({
            meetingId: meetingObjectId,
            userId: userObjectId,
            companyId: companyObjectId,
        });

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
        const allParticipants = await MeetingParticipant.find({
            meetingId: meetingObjectId,
        });

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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const participant = await MeetingParticipant.findOne({
            meetingId: meetingObjectId,
            userId: userObjectId,
            companyId: companyObjectId,
        });

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
        const allParticipants = await MeetingParticipant.find({
            meetingId: meetingObjectId,
        });
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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const participant = await MeetingParticipant.findOne({
            meetingId: meetingObjectId,
            userId: userObjectId,
            companyId: companyObjectId,
        });

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
            meetingId: meetingObjectId,
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
        const allParticipants = await MeetingParticipant.find({
            meetingId: meetingObjectId,
        });
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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const latestHistory = await MeetingScheduleHistory.findOne({
            meetingId: meetingObjectId,
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
            { meetingId: meetingObjectId },
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
        const allParticipants = await MeetingParticipant.find({
            meetingId: meetingObjectId,
        });
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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
            companyId: companyObjectId,
        });

        if (!meeting) {
            const err: any = new Error('Meeting not found');
            err.statusCode = 404;
            throw err;
        }

        const latestHistory = await MeetingScheduleHistory.findOne({
            meetingId: meetingObjectId,
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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
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
        const allParticipants = await MeetingParticipant.find({
            meetingId: meetingObjectId,
        });
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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const userObjectId = new Types.ObjectId(userId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
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

        const isParticipant = await MeetingParticipant.findOne({
            meetingId: meetingObjectId,
            userId: userObjectId,
        });

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
        const meetingObjectId = new Types.ObjectId(meetingId);
        const companyObjectId = new Types.ObjectId(companyId);

        const meeting = await Meeting.findOne({
            _id: meetingObjectId,
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
            MeetingParticipant.find({ meetingId: meetingObjectId })
                .populate('userId', 'name email avatar role')
                .lean(),
            MeetingScheduleHistory.find({ meetingId: meetingObjectId })
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
}
