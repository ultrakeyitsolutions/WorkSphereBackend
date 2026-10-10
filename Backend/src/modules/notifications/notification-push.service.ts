import { Types } from 'mongoose';
import { DeviceToken } from './device-token.model';
import { INotification } from './notification.model';

export class PushNotificationService {
    /**
     * Registers or updates a device push token for a user.
     */
    public static async registerPushToken(
        userId: string,
        companyId: string,
        pushToken: string,
        platform: 'ios' | 'android' | 'web' = 'android',
        deviceId?: string
    ): Promise<void> {
        if (!userId || !pushToken || !Types.ObjectId.isValid(userId)) return;

        await DeviceToken.findOneAndUpdate(
            { userId: new Types.ObjectId(userId), pushToken },
            {
                $set: {
                    userId: new Types.ObjectId(userId),
                    companyId: new Types.ObjectId(companyId),
                    pushToken,
                    platform,
                    deviceId: deviceId || null,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true }
        );
    }

    /**
     * Removes a device push token on user logout.
     */
    public static async removePushToken(userId: string, pushToken: string): Promise<void> {
        if (!userId || !pushToken || !Types.ObjectId.isValid(userId)) return;

        await DeviceToken.deleteOne({
            userId: new Types.ObjectId(userId),
            pushToken,
        });
    }

    /**
     * Sends native push notification to all active devices of a recipient.
     */
    public static async sendPushNotification(
        recipientId: string,
        notification: Partial<INotification>
    ): Promise<void> {
        try {
            if (!Types.ObjectId.isValid(recipientId)) return;

            const tokens = await DeviceToken.find({
                userId: new Types.ObjectId(recipientId),
            }).lean();

            if (!tokens || tokens.length === 0) return;

            const expoPushTokens = tokens
                .map((t) => t.pushToken)
                .filter((token) => token && token.startsWith('ExponentPushToken'));

            if (expoPushTokens.length === 0) return;

            const messages = expoPushTokens.map((token) => ({
                to: token,
                sound: 'default',
                title: notification.title || 'WorkSphere Notification',
                body: notification.message || '',
                data: {
                    id: notification._id?.toString(),
                    type: notification.type,
                    category: notification.category,
                    entityId: notification.entityId?.toString(),
                    entityType: notification.entityType,
                    projectId: notification.projectId?.toString(),
                    taskId: notification.taskId?.toString(),
                    meetingId: notification.meetingId?.toString(),
                    conversationId: notification.conversationId?.toString(),
                    actionUrl: notification.actionUrl,
                },
                channelId: 'worksphere-notifications',
            }));

            // Chunk in groups of 100 per Expo API specification
            const chunks: typeof messages[] = [];
            for (let i = 0; i < messages.length; i += 100) {
                chunks.push(messages.slice(i, i + 100));
            }

            for (const chunk of chunks) {
                try {
                    await fetch('https://exp.host/--/api/v2/push/send', {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Accept-encoding': 'gzip, deflate',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(chunk),
                    });
                } catch (pushErr) {
                    console.error('[PushNotificationService] Failed to send push chunk to Expo:', pushErr);
                }
            }
        } catch (err) {
            console.error('[PushNotificationService] Error sending push notification:', err);
        }
    }
}
