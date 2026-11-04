import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { SuperAdminNotificationService } from './super-admin-notification.service';
import { sendSuccess, sendError } from '../../../utils/response';

export class SuperAdminNotificationController {
    /**
     * GET /api/superadmin/notifications
     * List paginated notifications with filtering (category, priority, read status, date range, search)
     */
    public static async getNotifications(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const {
                category,
                priority,
                isRead,
                read,
                unread,
                startDate,
                endDate,
                companyId,
                search,
                page,
                limit,
            } = req.query as any;

            let parsedIsRead: boolean | undefined = undefined;
            if (isRead !== undefined) {
                parsedIsRead = isRead === 'true' || isRead === true;
            } else if (unread === 'true' || unread === true) {
                parsedIsRead = false;
            } else if (read === 'true' || read === true) {
                parsedIsRead = true;
            }

            const result = await SuperAdminNotificationService.getNotifications(superAdminId, {
                category,
                priority,
                isRead: parsedIsRead,
                startDate,
                endDate,
                companyId,
                search,
                page: page ? parseInt(page, 10) : 1,
                limit: limit ? parseInt(limit, 10) : 20,
            });

            return res.status(200).json({
                success: true,
                data: result.notifications,
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: result.totalPages,
                    unreadCount: result.unreadCount,
                },
            });
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to fetch SuperAdmin notifications', err.statusCode || 500);
        }
    }

    /**
     * GET /api/superadmin/notifications/unread-count
     */
    public static async getUnreadCount(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const unreadCount = await SuperAdminNotificationService.getUnreadCount(superAdminId);
            return sendSuccess(res, 'Unread count fetched successfully', { unreadCount });
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to fetch unread count', err.statusCode || 500);
        }
    }

    /**
     * GET /api/superadmin/notifications/:id
     */
    public static async getNotificationById(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const id = req.params.id as string;
            const notification = await SuperAdminNotificationService.getNotificationById(id, superAdminId);
            return sendSuccess(res, 'Notification retrieved successfully', notification);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to fetch notification', err.statusCode || 500);
        }
    }

    /**
     * PATCH /api/superadmin/notifications/:id/read
     */
    public static async markAsRead(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const id = req.params.id as string;
            const notification = await SuperAdminNotificationService.markAsRead(id, superAdminId);
            return sendSuccess(res, 'Notification marked as read', notification);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to mark notification as read', err.statusCode || 500);
        }
    }

    /**
     * PATCH /api/superadmin/notifications/read-all
     */
    public static async markAllAsRead(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const updatedCount = await SuperAdminNotificationService.markAllAsRead(superAdminId);
            return sendSuccess(res, `${updatedCount} notifications marked as read`, { updatedCount });
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to mark all notifications as read', err.statusCode || 500);
        }
    }

    /**
     * DELETE /api/superadmin/notifications/:id
     */
    public static async deleteNotification(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const id = req.params.id as string;
            await SuperAdminNotificationService.deleteNotification(id, superAdminId);
            return sendSuccess(res, 'Notification deleted successfully', null);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to delete notification', err.statusCode || 500);
        }
    }

    /**
     * DELETE /api/superadmin/notifications/read
     */
    public static async deleteReadNotifications(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const deletedCount = await SuperAdminNotificationService.deleteReadNotifications(superAdminId);
            return sendSuccess(res, `${deletedCount} read notifications deleted successfully`, { deletedCount });
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to delete read notifications', err.statusCode || 500);
        }
    }

    /**
     * GET /api/superadmin/notifications/preferences
     */
    public static async getPreferences(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const preferences = await SuperAdminNotificationService.getPreferences(superAdminId);
            return sendSuccess(res, 'Preferences retrieved successfully', preferences);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to fetch preferences', err.statusCode || 500);
        }
    }

    /**
     * PATCH /api/superadmin/notifications/preferences
     */
    public static async updatePreferences(req: AuthenticatedRequest, res: Response) {
        try {
            const superAdminId = req.authenticatedUser?.userId || req.user?.userId;
            if (!superAdminId) {
                return sendError(res, 'Unauthorized', 401);
            }

            const updatedPreferences = await SuperAdminNotificationService.updatePreferences(
                superAdminId,
                req.body
            );
            return sendSuccess(res, 'Preferences updated successfully', updatedPreferences);
        } catch (err: any) {
            return sendError(res, err.message || 'Failed to update preferences', err.statusCode || 500);
        }
    }
}
