import { Schema, model, Document, Types } from 'mongoose';
import { NotificationType, NotificationStyle, NotificationCategory, NotificationPriority } from './notification.types';

// ─── Notification Document ────────────────────────────────────────────────────

export interface INotification extends Document {
    companyId?: Types.ObjectId | null;
    recipientId: Types.ObjectId;
    recipientRole?: string;
    actorId?: Types.ObjectId;
    type: NotificationType;
    category: NotificationCategory | string;
    title: string;
    message: string;
    priority?: NotificationPriority;
    style: NotificationStyle;
    icon: string;
    entityId?: Types.ObjectId;
    entityType?: string;
    projectId?: Types.ObjectId;
    taskId?: Types.ObjectId;
    meetingId?: Types.ObjectId;
    conversationId?: Types.ObjectId;
    metadata?: Record<string, any>;
    actionUrl?: string;
    isRead: boolean;
    readAt?: Date;
    /** Idempotency key: eventId + recipientId */
    eventId?: string;
    /** TTL — MongoDB auto-deletes after this date */
    expiresAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
        recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        recipientRole: { type: String, default: 'EMPLOYEE', index: true },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        type: { type: String, required: true },
        category: { type: String, required: true },
        title: { type: String, required: true },
        message: { type: String, required: true },
        priority: {
            type: String,
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
            default: 'MEDIUM',
            index: true,
        },
        style: {
            type: String,
            enum: ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM'],
            default: 'INFO',
        },
        icon: { type: String, default: 'bell' },
        entityId: { type: Schema.Types.ObjectId, default: null },
        entityType: { type: String, default: null },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
        taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
        meetingId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent', default: null },
        conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
        metadata: { type: Schema.Types.Mixed, default: {} },
        actionUrl: { type: String, default: null },
        isRead: { type: Boolean, default: false, index: true },
        readAt: { type: Date, default: null },
        eventId: { type: String, default: null, index: true },
        expiresAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// ─── Indexes (per spec §21 \u0026 SuperAdmin requirements) ──────────────────────
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, isRead: 1 });
notificationSchema.index({ recipientId: 1, category: 1 });
notificationSchema.index({ recipientId: 1, priority: 1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ category: 1 });
notificationSchema.index({ companyId: 1, createdAt: -1 });
notificationSchema.index({ companyId: 1, type: 1 });
notificationSchema.index({ entityType: 1, entityId: 1 });

// TTL index — MongoDB removes documents after expiresAt (§24)
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

// Idempotency index — sparse so null eventId rows are excluded (§27)
notificationSchema.index(
    { eventId: 1, recipientId: 1 },
    { unique: true, sparse: true, partialFilterExpression: { eventId: { $ne: null } } }
);

export const Notification = model<INotification>('Notification', notificationSchema);

