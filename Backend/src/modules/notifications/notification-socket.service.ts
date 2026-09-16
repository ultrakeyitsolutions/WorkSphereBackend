import { getSocketServer } from '../../sockets/socket-server';
import { INotification } from './notification.model';

// ─── Socket Notification Channel ──────────────────────────────────────────
// Handles real-time Delivery of notifications to connected users via Socket.IO

export class SocketNotificationChannel {
    /**
     * Emits a real-time notification to a specific recipient user's socket room.
     */
    public static deliverNotification(recipientId: string, notification: Partial<INotification>): void {
        const io = getSocketServer();
        if (!io) return; // Socket server not initialized yet or running in background script

        const room = `user:${recipientId}`;
        io.to(room).emit('notification:new', {
            id: notification._id,
            notificationType: notification.type,
            category: notification.category,
            title: notification.title,
            message: notification.message,
            style: notification.style,
            icon: notification.icon,
            entityId: notification.entityId,
            entityType: notification.entityType,
            actionUrl: notification.actionUrl,
            metadata: notification.metadata,
            createdAt: notification.createdAt,
            isRead: false,
        });
    }

    /**
     * Emits unread notification count update to a recipient.
     */
    public static deliverUnreadCount(recipientId: string, unreadCount: number): void {
        const io = getSocketServer();
        if (!io) return;

        const room = `user:${recipientId}`;
        io.to(room).emit('notification:unread_count', { unreadCount });
    }
}
