import { Router } from 'express';
import { requireSuperAdmin } from '../shared/super-admin-guard';
import { SuperAdminNotificationController } from './super-admin-notification.controller';

const router = Router();

// Enforce authentication & strict SUPER_ADMIN role verification on all endpoints
router.use(requireSuperAdmin);

// Unread count & Preferences (defined before parameterized routes)
router.get('/unread-count', SuperAdminNotificationController.getUnreadCount);
router.get('/preferences', SuperAdminNotificationController.getPreferences);
router.patch('/preferences', SuperAdminNotificationController.updatePreferences);

// Bulk operations (defined before parameterized :id routes)
router.patch('/read-all', SuperAdminNotificationController.markAllAsRead);
router.delete('/read', SuperAdminNotificationController.deleteReadNotifications);

// Listing
router.get('/', SuperAdminNotificationController.getNotifications);

// Single notification operations
router.get('/:id', SuperAdminNotificationController.getNotificationById);
router.patch('/:id/read', SuperAdminNotificationController.markAsRead);
router.delete('/:id', SuperAdminNotificationController.deleteNotification);

export default router;
