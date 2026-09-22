import { Types } from 'mongoose';
import { CalendarEvent } from '../../calendar/calendar-event.model';
import { DashboardScopeContext, MeetingItem, MeetingsAnalyticsResponse } from '../dashboard.types';

export class MeetingAnalytics {
    public static async getMeetingAnalytics(context: DashboardScopeContext, now = new Date()): Promise<MeetingsAnalyticsResponse> {
        const { companyId, userId, isCompanyWide, filterProjectId, dateRange } = context;

        const match: any = { companyId };

        if (filterProjectId) {
            match.projectId = filterProjectId;
        }

        if (!isCompanyWide) {
            match.$or = [
                { 'organizer.userId': userId },
                { 'participants.userId': userId },
            ];
        }

        if (dateRange.startDate && dateRange.endDate) {
            match.startTime = { $gte: dateRange.startDate, $lte: dateRange.endDate };
        }

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        const events = await CalendarEvent.find(match)
            .sort({ startTime: 1 })
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
