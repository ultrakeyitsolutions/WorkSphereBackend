import { CalendarEvent } from '../../calendar/calendar-event.model';
import { Meeting } from '../../meetings/models/meeting.model';
import { MeetingParticipant } from '../../meetings/models/meeting-participant.model';
import { DashboardScopeContext, MeetingItem, MeetingsAnalyticsResponse } from '../dashboard.types';
import { Types } from 'mongoose';

export class MeetingAnalytics {
    public static async getMeetingAnalytics(context: DashboardScopeContext, now = new Date()): Promise<MeetingsAnalyticsResponse> {
        const { companyId, userId, isCompanyWide, filterProjectId, dateRange } = context;

        const match: any = { companyId: new Types.ObjectId(companyId) };

        if (filterProjectId && Types.ObjectId.isValid(filterProjectId)) {
            match.projectId = new Types.ObjectId(filterProjectId);
        }

        if (!isCompanyWide && userId) {
            match.$or = [
                { 'organizer.userId': new Types.ObjectId(userId) },
                { 'participants.userId': new Types.ObjectId(userId) },
            ];
        }

        if (dateRange.startDate && dateRange.endDate) {
            match.startTime = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        // Fetch calendar events
        const events = await CalendarEvent.find(match)
            .sort({ startTime: 1 })
            .lean();

        // Also fetch any canonical Meetings that do not have matching CalendarEvents to avoid gaps
        const meetingMatch: any = {
            companyId: new Types.ObjectId(companyId),
            calendarEventId: null,
        };
        if (filterProjectId && Types.ObjectId.isValid(filterProjectId)) {
            meetingMatch.projectId = new Types.ObjectId(filterProjectId);
        }
        if (dateRange.startDate && dateRange.endDate) {
            meetingMatch.scheduledStartAt = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }
        if (!isCompanyWide && userId) {
            const pDocs = await MeetingParticipant.find({
                companyId: new Types.ObjectId(companyId),
                userId: new Types.ObjectId(userId),
            }).select('meetingId').lean();
            const mIds = pDocs.map((p) => p.meetingId);
            meetingMatch.$or = [
                { organizerId: new Types.ObjectId(userId) },
                { _id: { $in: mIds } },
            ];
        }

        const unlinkedMeetings = await Meeting.find(meetingMatch)
            .populate('organizerId', 'name email avatar')
            .sort({ scheduledStartAt: 1 })
            .lean();

        let todayCount = 0;
        let upcomingCount = 0;
        let startedCount = 0;
        let completedCount = 0;
        let totalMinutes = 0;

        const items: MeetingItem[] = [];

        for (const evt of events) {
            const start = new Date(evt.startTime);
            const end = new Date(evt.endTime);
            const durationMins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

            totalMinutes += durationMins;

            if (start >= todayStart && start <= todayEnd) {
                todayCount++;
            }

            if (start > now) {
                upcomingCount++;
            } else if (start <= now && end >= now) {
                startedCount++;
            } else if (end < now) {
                completedCount++;
            }

            items.push({
                id: String(evt._id),
                title: evt.title,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                meetingType: evt.meetingType || 'video',
                provider: evt.provider || 'none',
                meetingUrl: evt.meetingUrl || null,
                organizerName: evt.organizer?.name || 'Organizer',
                participantCount: (evt.participants || []).length,
            });
        }

        for (const m of unlinkedMeetings) {
            const start = new Date(m.scheduledStartAt);
            const end = new Date(m.scheduledEndAt);
            const durationMins = m.durationMinutes || Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

            totalMinutes += durationMins;

            if (start >= todayStart && start <= todayEnd) {
                todayCount++;
            }

            if (start > now) {
                upcomingCount++;
            } else if (start <= now && end >= now) {
                startedCount++;
            } else if (end < now) {
                completedCount++;
            }

            items.push({
                id: String(m._id),
                title: m.title,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                meetingType: 'video',
                provider: m.meetingProvider || 'none',
                meetingUrl: m.meetingLink || null,
                organizerName: (m.organizerId as any)?.name || 'Organizer',
                participantCount: 1,
            });
        }

        // Sort combined items by startTime ascending
        items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        return {
            today: todayCount,
            upcoming: upcomingCount,
            started: startedCount,
            completed: completedCount,
            cancelled: 0,
            totalMinutes,
            items: items.slice(0, 10),
        };
    }
}
