import { Types } from 'mongoose';
import { Meeting } from './models/meeting.model';
import { MeetingParticipant } from './models/meeting-participant.model';
import { CalendarEvent } from '../calendar/calendar-event.model';
import { MeetingStatus, ParticipantResponseStatus } from './meeting.types';
import { MEETING_CONFIG } from './meeting.constants';

export interface ConflictResult {
    hasConflict: boolean;
    conflicts: Array<{
        userId: string;
        source: 'MEETING' | 'CALENDAR_EVENT';
        title: string;
        startAt: Date;
        endAt: Date;
    }>;
}

export interface AvailabilitySlot {
    start: string; // e.g., "09:00"
    end: string;   // e.g., "09:30"
    isAvailable: boolean;
}

export class MeetingSchedulingService {
    /**
     * Check whether any of the given participants have conflicting meetings/events in the given time window.
     */
    public static async checkConflicts(
        companyId: string | Types.ObjectId,
        userIds: (string | Types.ObjectId)[],
        startAt: Date,
        endAt: Date,
        excludeMeetingId?: string | Types.ObjectId
    ): Promise<ConflictResult> {
        const userObjectIds = userIds.map((id) => new Types.ObjectId(id.toString()));
        const companyObjectId = new Types.ObjectId(companyId.toString());

        const activeMeetingStatuses = [
            MeetingStatus.PENDING,
            MeetingStatus.ACCEPTED,
            MeetingStatus.RESCHEDULED,
            MeetingStatus.IN_PROGRESS,
        ];

        // 1. Find overlapping meetings where these users are participants
        const meetingQuery: any = {
            companyId: companyObjectId,
            status: { $in: activeMeetingStatuses },
            $or: [
                // Overlap condition: (StartA < EndB) and (EndA > StartB)
                {
                    scheduledStartAt: { $lt: endAt },
                    scheduledEndAt: { $gt: startAt },
                },
            ],
        };

        if (excludeMeetingId && Types.ObjectId.isValid(excludeMeetingId.toString())) {
            meetingQuery._id = { $ne: new Types.ObjectId(excludeMeetingId.toString()) };
        }

        const overlappingMeetings = await Meeting.find(meetingQuery).lean();
        const conflicts: ConflictResult['conflicts'] = [];

        if (overlappingMeetings.length > 0) {
            const meetingIds = overlappingMeetings.map((m) => m._id);
            const participantsInOverlapping = await MeetingParticipant.find({
                meetingId: { $in: meetingIds },
                userId: { $in: userObjectIds },
                responseStatus: { $ne: ParticipantResponseStatus.DECLINED },
            }).lean();

            const meetingMap = new Map<string, any>();
            overlappingMeetings.forEach((m) => meetingMap.set(m._id.toString(), m));

            for (const p of participantsInOverlapping) {
                const m = meetingMap.get(p.meetingId.toString());
                if (m) {
                    conflicts.push({
                        userId: p.userId.toString(),
                        source: 'MEETING',
                        title: m.title,
                        startAt: m.scheduledStartAt,
                        endAt: m.scheduledEndAt,
                    });
                }
            }
        }

        // 2. Find overlapping calendar events if any
        const calendarQuery: any = {
            companyId: companyObjectId,
            $or: [
                {
                    startTime: { $lt: endAt },
                    endTime: { $gt: startAt },
                },
            ],
            status: { $nin: ['cancelled', 'CANCELLED'] },
        };

        const overlappingEvents = await CalendarEvent.find(calendarQuery).lean();
        for (const evt of overlappingEvents) {
            const participantUserIds = (evt.participants || [])
                .filter((p: any) => p.status !== 'declined')
                .map((p: any) => p.userId?.toString());

            const organizerUserId = (evt.organizer as any)?.userId?.toString();

            for (const uId of userObjectIds) {
                const uIdStr = uId.toString();
                if (participantUserIds.includes(uIdStr) || organizerUserId === uIdStr) {
                    conflicts.push({
                        userId: uIdStr,
                        source: 'CALENDAR_EVENT',
                        title: evt.title,
                        startAt: evt.startTime,
                        endAt: evt.endTime,
                    });
                }
            }
        }

        return {
            hasConflict: conflicts.length > 0,
            conflicts,
        };
    }

    /**
     * Compute available time slots for a user on a given date (YYYY-MM-DD).
     */
    public static async getAvailability(
        companyId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        dateStr: string,
        durationMinutes: number = MEETING_CONFIG.DEFAULT_DURATION_MINUTES
    ): Promise<{ date: string; slots: AvailabilitySlot[]; freeSlots: string[] }> {
        const userObjectId = new Types.ObjectId(userId.toString());
        const companyObjectId = new Types.ObjectId(companyId.toString());

        // Parse day start and end in UTC / local
        const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
        const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

        // Find all meetings and events for this user on this day
        const [userParticipants, userEvents] = await Promise.all([
            MeetingParticipant.find({
                userId: userObjectId,
                companyId: companyObjectId,
                responseStatus: { $ne: ParticipantResponseStatus.DECLINED },
            }).lean(),
            CalendarEvent.find({
                companyId: companyObjectId,
                $or: [
                    { 'participants.userId': userObjectId },
                    { 'organizer.userId': userObjectId },
                ],
                startTime: { $lte: dayEnd },
                endTime: { $gte: dayStart },
                status: { $nin: ['cancelled', 'CANCELLED'] },
            }).lean(),
        ]);

        const meetingIds = userParticipants.map((p) => p.meetingId);
        const dayMeetings = await Meeting.find({
            _id: { $in: meetingIds },
            companyId: companyObjectId,
            scheduledStartAt: { $lte: dayEnd },
            scheduledEndAt: { $gte: dayStart },
            status: {
                $in: [
                    MeetingStatus.PENDING,
                    MeetingStatus.ACCEPTED,
                    MeetingStatus.RESCHEDULED,
                    MeetingStatus.IN_PROGRESS,
                ],
            },
        }).lean();

        // Busy intervals
        const busyIntervals: Array<{ start: number; end: number }> = [];

        dayMeetings.forEach((m) => {
            busyIntervals.push({
                start: new Date(m.scheduledStartAt).getTime(),
                end: new Date(m.scheduledEndAt).getTime(),
            });
        });

        userEvents.forEach((e) => {
            busyIntervals.push({
                start: new Date(e.startTime).getTime(),
                end: new Date(e.endTime).getTime(),
            });
        });

        const startHour = MEETING_CONFIG.WORKDAY_START_HOUR;
        const endHour = MEETING_CONFIG.WORKDAY_END_HOUR;
        const stepMinutes = MEETING_CONFIG.AVAILABILITY_SLOT_INTERVAL_MINUTES;

        const slots: AvailabilitySlot[] = [];
        const freeSlots: string[] = [];

        for (let hour = startHour; hour < endHour; hour++) {
            for (let min = 0; min < 60; min += stepMinutes) {
                const slotStart = new Date(dayStart);
                slotStart.setUTCHours(hour, min, 0, 0);

                const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

                // If slot extends beyond workday end, skip
                if (slotEnd.getUTCHours() > endHour || (slotEnd.getUTCHours() === endHour && slotEnd.getUTCMinutes() > 0)) {
                    continue;
                }

                const sStartMs = slotStart.getTime();
                const sEndMs = slotEnd.getTime();

                const isBlocked = busyIntervals.some(
                    (busy) => sStartMs < busy.end && sEndMs > busy.start
                );

                const formatTime = (d: Date) =>
                    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

                const slotTimeStr = formatTime(slotStart);
                slots.push({
                    start: slotTimeStr,
                    end: formatTime(slotEnd),
                    isAvailable: !isBlocked,
                });

                if (!isBlocked) {
                    freeSlots.push(slotTimeStr);
                }
            }
        }

        return {
            date: dateStr,
            slots,
            freeSlots,
        };
    }
}
