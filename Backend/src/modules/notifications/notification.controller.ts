import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { NotificationService } from './notification.service';
import { NOTIFICATION_TYPES } from './notification.types';

const service = new NotificationService();

/**
 * GET /api/v1/notifications
 * Retrieves paginated notifications for the authenticated user.
 */
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const companyId = req.user?.companyId;

        if (!userId || !companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        const result = await service.getUserNotifications(userId, companyId, page, limit);

        return res.status(200).json({
            success: true,
            data: result.notifications,
            pagination: {
                page: result.page,
                limit: result.limit,
                total: result.total,
                pages: result.pages,
                unreadCount: result.unreadCount,
            },
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: err.message });
    }
};

/**
 * GET /api/v1/notifications/unread-count
 * Returns unread notification count.
 */
export const getUnreadCount = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const companyId = req.user?.companyId;

        if (!userId || !companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const unreadCount = await service.getUnreadCount(userId, companyId);

        return res.status(200).json({
            success: true,
            data: { unreadCount },
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to fetch unread count', error: err.message });
    }
};

/**
 * GET /api/v1/notifications/types
 * Returns all notification types registered in the system metadata.
 */
export const getNotificationTypes = async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const typesList = Object.entries(NOTIFICATION_TYPES).map(([key, value]) => ({
            type: key,
            name: value.name,
            category: value.category,
            description: value.description,
            defaultStyle: value.defaultStyle,
            defaultChannels: value.defaultChannels,
            allowedVariables: value.allowedVariables,
        }));

        return res.status(200).json({
            success: true,
            data: typesList,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to fetch notification types', error: err.message });
    }
};

/**
 * PATCH /api/v1/notifications/:id/read
 * Marks a single notification as read.
 */
export const markNotificationAsRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const notificationId = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const updated = await service.markAsRead(notificationId, userId);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            data: updated,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to mark notification as read', error: err.message });
    }
};

/**
 * PATCH /api/v1/notifications/read-all
 * Marks all notifications as read for the user.
 */
export const markAllNotificationsAsRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const companyId = req.user?.companyId;

        if (!userId || !companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const modifiedCount = await service.markAllAsRead(userId, companyId);

        return res.status(200).json({
            success: true,
            message: `${modifiedCount} notifications marked as read`,
            data: { modifiedCount },
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to mark all notifications as read', error: err.message });
    }
};

/**
 * DELETE /api/v1/notifications/:id
 * Deletes a notification for the user.
 */
export const deleteNotification = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const notificationId = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const success = await service.deleteNotification(notificationId, userId);
        if (!success) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Notification deleted successfully',
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to delete notification', error: err.message });
    }
};
