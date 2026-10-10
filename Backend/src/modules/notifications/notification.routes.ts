import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
    getNotifications,
    getUnreadCount,
    getNotificationTypes,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    clearAllNotifications,
    registerPushToken,
    removePushToken,
} from './notification.controller';

const router = Router();

// Apply authentication middleware to all notification routes
router.use(authenticate);

// Push Token Registration & Removal
router.post('/push-token', registerPushToken);
router.delete('/push-token', removePushToken);

// Listing & Types
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/unread', getUnreadCount);
router.get('/types', getNotificationTypes);

// Bulk & Individual Read Status
router.patch('/read-all', markAllNotificationsAsRead);
router.patch('/:id/read', markNotificationAsRead);

// Deletion & Clear All
router.delete('/clear-all', clearAllNotifications);
router.delete('/', clearAllNotifications);
router.delete('/:id', deleteNotification);

export default router;
