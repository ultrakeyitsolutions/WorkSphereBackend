import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
    getNotifications,
    getUnreadCount,
    getNotificationTypes,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
} from './notification.controller';

const router = Router();

// Apply authentication middleware to all notification routes
router.use(authenticate);

// Listing & Types
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/unread', getUnreadCount);
router.get('/types', getNotificationTypes);

// Bulk & Individual Read Status
router.patch('/read-all', markAllNotificationsAsRead);
router.patch('/:id/read', markNotificationAsRead);

// Deletion
router.delete('/:id', deleteNotification);

export default router;
