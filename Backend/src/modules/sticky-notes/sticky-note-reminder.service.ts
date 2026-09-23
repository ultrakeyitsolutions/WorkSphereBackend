import { Types } from 'mongoose';
import { StickyNote } from './sticky-note.model';
import { UpcomingRemindersFilter, UpcomingTimeframe } from './sticky-note.types';
import { NotificationService } from '../notifications/notification.service';
import { User } from '../users/user.model';

let reminderInterval: NodeJS.Timeout | null = null;

export class StickyNoteReminderService {
    private static notificationService = new NotificationService();

    /**
     * Process due sticky note reminders and send notifications idempotently.
     */
    public static async processDueReminders(): Promise<number> {
        try {
            const now = new Date();

            // Find all active notes with due, unsent reminders
            const dueNotes = await StickyNote.find({
                deletedAt: null,
                reminderAt: { $ne: null, $lte: now },
                reminderSentAt: null,
            })
                .limit(100)
                .lean();

            if (dueNotes.length === 0) {
                return 0;
            }

            let sentCount = 0;

            for (const note of dueNotes) {
                // Atomic update: only proceed if reminderSentAt is still null (concurrency lock)
                const updated = await StickyNote.findOneAndUpdate(
                    {
                        _id: note._id,
                        reminderSentAt: null,
                    },
                    {
                        $set: { reminderSentAt: now },
                    },
                    { new: true }
                );

                if (!updated) {
                    continue;
                }

                // Fetch user for companyId context
                const user = await User.findById(note.userId).select('companyId name email').lean();
                const companyId = user?.companyId ? user.companyId.toString() : '';

                const noteTitle = note.title && note.title.trim().length > 0 ? note.title : 'Sticky Note';
                const snippet = note.content.length > 120 ? `${note.content.substring(0, 117)}...` : note.content;

                if (companyId) {
                    await this.notificationService.publish({
                        type: 'STICKY_NOTE_REMINDER',
                        companyId,
                        actorId: note.userId.toString(),
                        eventId: `sticky-reminder-${note._id.toString()}-${now.getTime()}`,
                        entityId: note._id.toString(),
                        entityType: 'STICKY_NOTE',
                        recipientIds: [note.userId.toString()],
                        metadata: {
                            title: noteTitle,
                            content: snippet,
                            noteId: note._id.toString(),
                            color: note.color,
                            priority: note.priority,
                            reminderAt: note.reminderAt,
                            includeActor: true, // Personal notification meant for the owner
                        },
                        actionUrl: `/dashboard?noteId=${note._id.toString()}`,
                    });
                }

                sentCount++;
            }

            return sentCount;
        } catch (error) {
            console.error('[StickyNoteReminderService] Error processing sticky note reminders:', error);
            return 0;
        }
    }

    /**
     * Get upcoming reminders for the authenticated user based on timeframe or date range.
     */
    public static async getUpcomingReminders(
        userId: string,
        filter: UpcomingRemindersFilter = {}
    ) {
        const { timeframe = 'this-week', startDate, endDate, page = 1, limit = 20 } = filter;
        const now = new Date();

        let start = now;
        let end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead

        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else if (timeframe) {
            switch (timeframe as UpcomingTimeframe) {
                case 'today': {
                    const todayEnd = new Date(now);
                    todayEnd.setUTCHours(23, 59, 59, 999);
                    end = todayEnd;
                    break;
                }
                case 'tomorrow': {
                    const tomStart = new Date(now);
                    tomStart.setDate(tomStart.getDate() + 1);
                    tomStart.setUTCHours(0, 0, 0, 0);
                    start = tomStart;

                    const tomEnd = new Date(tomStart);
                    tomEnd.setUTCHours(23, 59, 59, 999);
                    end = tomEnd;
                    break;
                }
                case 'this-week': {
                    const weekEnd = new Date(now);
                    weekEnd.setDate(weekEnd.getDate() + 7);
                    end = weekEnd;
                    break;
                }
                case 'all': {
                    start = new Date(0);
                    end = new Date('2100-01-01');
                    break;
                }
            }
        }

        const query: Record<string, any> = {
            userId: new Types.ObjectId(userId),
            deletedAt: null,
            reminderAt: {
                $gte: start,
                $lte: end,
            },
        };

        const skip = (page - 1) * limit;

        const [notes, total] = await Promise.all([
            StickyNote.find(query)
                .sort({ reminderAt: 1 })
                .skip(skip)
                .limit(limit)
                .populate('projectId', 'name')
                .populate('taskId', 'title taskNumber')
                .lean(),
            StickyNote.countDocuments(query),
        ]);

        const data = notes.map((n) => ({
            id: n._id.toString(),
            title: n.title || '',
            content: n.content,
            color: n.color,
            priority: n.priority,
            tags: n.tags,
            isPinned: n.isPinned,
            status: n.status,
            checklist: n.checklist,
            reminderAt: n.reminderAt,
            reminderSentAt: n.reminderSentAt,
            project: n.projectId ? { id: (n.projectId as any)._id, name: (n.projectId as any).name } : null,
            task: n.taskId ? { id: (n.taskId as any)._id, title: (n.taskId as any).title, taskNumber: (n.taskId as any).taskNumber } : null,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
        }));

        return {
            data,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}

// ─── Background Reminder Job ──────────────────────────────────────────────────

export class StickyNoteReminderJob {
    /**
     * Start the recurring reminder processor
     */
    public static start(intervalMs: number = 60 * 1000): void {
        if (reminderInterval) {
            return;
        }

        // Run initial tick
        StickyNoteReminderService.processDueReminders().catch((err) => {
            console.error('[StickyNoteReminderJob] Initial reminder tick error:', err);
        });

        // Setup recurring interval
        reminderInterval = setInterval(() => {
            StickyNoteReminderService.processDueReminders().catch((err) => {
                console.error('[StickyNoteReminderJob] Recurring reminder tick error:', err);
            });
        }, intervalMs);

        console.log('[StickyNoteReminderJob] Sticky note reminder background scheduler initialized.');
    }

    /**
     * Stop the scheduler (for graceful shutdown / tests)
     */
    public static stop(): void {
        if (reminderInterval) {
            clearInterval(reminderInterval);
            reminderInterval = null;
        }
    }
}
