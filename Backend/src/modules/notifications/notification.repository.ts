import { Types } from 'mongoose';
import { Notification, INotification } from './notification.model';
import { NotificationPreference, INotificationPreference } from './notification-preference.model';
import { NotificationType } from './notification.types';

// ─── Notification Repository ──────────────────────────────────────────────────

export interface CreateNotificationDto {
    companyId: string | Types.ObjectId;
    recipientId: string | Types.ObjectId;
    actorId?: string | Types.ObjectId;
    type: NotificationType;
    category: string;
    title: string;
    message: string;
    style: string;
    icon: string;
    entityId?: string | Types.ObjectId;
    entityType?: string;
    actionUrl?: string;
    projectId?: string | Types.ObjectId;
    taskId?: string | Types.ObjectId;
    meetingId?: string | Types.ObjectId;
    conversationId?: string | Types.ObjectId;
    metadata?: Record<string, any>;
    eventId?: string;
    expiresAt: Date;
}

export class NotificationRepository {
    /**
     * Checks if notification for an idempotency key (eventId + recipientId) already exists.
     */
    static async existsByIdempotency(eventId: string, recipientId: string | Types.ObjectId): Promise<boolean> {
        const count = await Notification.countDocuments({
            eventId,
            recipientId: new Types.ObjectId(recipientId),
        });
        return count > 0;
    }

    /**
     * Batch creates notification documents in MongoDB.
     */
    static async createMany(docs: Partial<INotification>[]): Promise<INotification[]> {
        if (!docs.length) return [];
        try {
            const created = await Notification.insertMany(docs, { ordered: false });
            return created as INotification[];
        } catch (err: any) {
            // If duplicate key error occurs during batch, return inserted docs if any
            if (err?.insertedDocs) {
                return err.insertedDocs as INotification[];
            }
            if (err?.code !== 11000 && !err?.writeErrors?.every((e: any) => e.code === 11000)) {
                throw err;
            }
            return [];
        }
    }

    static async findByRecipient(
        recipientId: string,
        companyId: string,
        pageVal = 1,
        limitVal = 20
    ): Promise<{ notifications: INotification[]; total: number; page: number; limit: number; pages: number; unreadCount: number }> {
        const page = Math.max(1, pageVal);
        const limit = Math.min(100, Math.max(1, limitVal));
        const skip = (page - 1) * limit;

        const query = {
            recipientId: new Types.ObjectId(recipientId),
            companyId: new Types.ObjectId(companyId),
        };

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments(query),
            Notification.countDocuments({ ...query, isRead: false }),
        ]);

        return {
            notifications: notifications as INotification[],
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
            unreadCount,
        };
    }

    static async countUnread(recipientId: string, companyId: string): Promise<number> {
        return Notification.countDocuments({
            recipientId: new Types.ObjectId(recipientId),
            companyId: new Types.ObjectId(companyId),
            isRead: false,
        });
    }

    static async markRead(notificationId: string, recipientId: string): Promise<INotification | null> {
        const notif = await Notification.findOneAndUpdate(
            {
                _id: new Types.ObjectId(notificationId),
                recipientId: new Types.ObjectId(recipientId),
            },
            { $set: { isRead: true, readAt: new Date() } },
            { new: true }
        ).lean();

        return notif as INotification | null;
    }

    static async markAllRead(recipientId: string, companyId: string): Promise<number> {
        const result = await Notification.updateMany(
            {
                recipientId: new Types.ObjectId(recipientId),
                companyId: new Types.ObjectId(companyId),
                isRead: false,
            },
            { $set: { isRead: true, readAt: new Date() } }
        );
        return result.modifiedCount;
    }

    static async delete(notificationId: string, recipientId: string): Promise<boolean> {
        const result = await Notification.deleteOne({
            _id: new Types.ObjectId(notificationId),
            recipientId: new Types.ObjectId(recipientId),
        });
        return result.deletedCount > 0;
    }

    // ── Preference Helpers ──────────────────────────────────────────────────

    static async getPreference(
        companyId: string | Types.ObjectId,
        type: NotificationType
    ): Promise<INotificationPreference | null> {
        return NotificationPreference.findOne({
            companyId: new Types.ObjectId(companyId),
            notificationType: type,
        }).lean();
    }

    static async getCompanyPreferences(
        companyId: string | Types.ObjectId
    ): Promise<INotificationPreference[]> {
        return NotificationPreference.find({
            companyId: new Types.ObjectId(companyId),
        }).lean();
    }

    static async upsertPreference(
        companyId: string | Types.ObjectId,
        type: NotificationType,
        data: Record<string, any>
    ): Promise<INotificationPreference> {
        return NotificationPreference.findOneAndUpdate(
            { companyId: new Types.ObjectId(companyId), notificationType: type },
            { $set: data },
            { upsert: true, new: true, runValidators: true }
        ).lean() as Promise<INotificationPreference>;
    }

    static async bulkUpsertPreferences(
        companyId: string | Types.ObjectId,
        preferences: Array<Partial<INotificationPreference>>
    ): Promise<void> {
        if (!preferences.length) return;
        const ops = preferences.map((p) => ({
            updateOne: {
                filter: { companyId: new Types.ObjectId(companyId), notificationType: p.notificationType },
                update: { $set: p },
                upsert: true,
            },
        }));
        await NotificationPreference.bulkWrite(ops as any);
    }
}
