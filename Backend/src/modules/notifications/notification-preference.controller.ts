import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationType } from './notification.types';

const prefService = new NotificationPreferenceService();

/**
 * GET /api/v1/company/notification-preferences
 * Retrieves all notification settings for the company grouped by category.
 */
export const getCompanyNotificationPreferences = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;

        if (!companyId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: missing company context' });
        }

        const preferences = await prefService.getCompanyPreferences(companyId);

        return res.status(200).json({
            success: true,
            data: preferences,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, message: 'Failed to fetch notification preferences', error: err.message });
    }
};

/**
 * PATCH /api/v1/company/notification-preferences/:type
 * Updates preference settings (enabled, channels, template, style) for a specific notification type.
 */
export const updateCompanyNotificationPreference = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const notificationType = req.params.type as NotificationType;
        const { enabled, channels, style, template } = req.body;

        if (!companyId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const updated = await prefService.updatePreference(
            companyId,
            notificationType,
            { enabled, channels, style, template },
            userId
        );

        return res.status(200).json({
            success: true,
            message: 'Notification preference updated successfully',
            data: updated,
        });
    } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message || 'Failed to update notification preference' });
    }
};
