import { Meeting } from './models/meeting.model';
import { MeetingParticipant } from './models/meeting-participant.model';
import { MeetingStatus, ParticipantResponseStatus } from './meeting.types';
import { MeetingNotificationService } from './meeting-notification.service';

let schedulerInterval: NodeJS.Timeout | null = null;

export class MeetingSchedulerJob {
    /**
     * Run a single tick of the reminder scan
     */
    public static async processReminders(): Promise<void> {
        try {
            const now = Date.now();
            const windowEnd = new Date(now + 16 * 60 * 1000); // 16 minutes ahead
            const windowStart = new Date(now - 1 * 60 * 1000); // within last 1 minute

            const activeStatuses = [
                MeetingStatus.PENDING,
                MeetingStatus.ACCEPTED,
                MeetingStatus.RESCHEDULED,
            ];

            // Indexed query: find upcoming meetings in the reminder window
            const upcomingMeetings = await Meeting.find({
                status: { $in: activeStatuses },
                scheduledStartAt: { $gte: windowStart, $lte: windowEnd },
                $or: [{ reminded15Min: { $ne: true } }, { reminded5Min: { $ne: true } }],
            }).lean();

            if (upcomingMeetings.length === 0) {
                return;
            }

            for (const meeting of upcomingMeetings) {
                const startMs = new Date(meeting.scheduledStartAt).getTime();
                const diffMinutes = Math.floor((startMs - now) / (60 * 1000));

                const updates: any = {};
                let send5 = false;

                if (diffMinutes <= 15 && diffMinutes > 5 && !meeting.reminded15Min) {
                    updates.reminded15Min = true;
                } else if (diffMinutes <= 5 && diffMinutes >= -1 && !meeting.reminded5Min) {
                    updates.reminded5Min = true;
                    if (!meeting.reminded15Min) {
                        updates.reminded15Min = true;
                    }
                    send5 = true;
                }

                if (Object.keys(updates).length > 0) {
                    await Meeting.updateOne({ _id: meeting._id }, { $set: updates });

                    // Find active participants to notify
                    const participants = await MeetingParticipant.find({
                        meetingId: meeting._id,
                        responseStatus: { $ne: ParticipantResponseStatus.DECLINED },
                    }).lean();

                    const recipientIds = participants.map((p) => p.userId.toString());
                    const minutesUntil = send5 ? 5 : 15;

                    MeetingNotificationService.sendMeetingNotification({
                        type: 'MEETING_STARTING_SOON',
                        companyId: meeting.companyId.toString(),
                        actorId: meeting.organizerId.toString(),
                        meetingId: meeting._id.toString(),
                        recipientIds,
                        meetingTitle: meeting.title,
                        scheduledStartAt: meeting.scheduledStartAt,
                        minutesUntilStart: minutesUntil,
                        meetingLink: meeting.meetingLink || undefined,
                        actionUrl: `/companyadmin/quick-meetings?meetingId=${meeting._id}`,
                    });
                }
            }
        } catch (error) {
            console.error('[MeetingSchedulerJob] Error processing meeting reminders:', error);
        }
    }

    /**
     * Start the recurring scheduler
     */
    public static start(intervalMs: number = 60 * 1000): void {
        if (schedulerInterval) {
            return;
        }

        // Run immediately on start
        this.processReminders().catch((err) => {
            console.error('[MeetingSchedulerJob] Initial reminder tick error:', err);
        });

        // Set recurring timer
        schedulerInterval = setInterval(() => {
            this.processReminders().catch((err) => {
                console.error('[MeetingSchedulerJob] Recurring reminder tick error:', err);
            });
        }, intervalMs);

        console.log('[MeetingSchedulerJob] Meeting reminder background scheduler initialized.');
    }

    /**
     * Stop the scheduler (for graceful shutdown / tests)
     */
    public static stop(): void {
        if (schedulerInterval) {
            clearInterval(schedulerInterval);
            schedulerInterval = null;
        }
    }
}
