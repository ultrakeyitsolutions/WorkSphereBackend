import mongoose, { Types } from 'mongoose';
import { getMailTransporter, mailDefaults } from '../../config/mail';
import { env } from '../../config/env';
import { INotification } from './notification.model';

export class EmailNotificationChannel {
    /**
     * Dispatches an email notification if the user has an email and company preference has email channel enabled.
     */
    public static async sendNotificationEmail(
        recipientId: string,
        notification: Partial<INotification>
    ): Promise<void> {
        try {
            if (!Types.ObjectId.isValid(recipientId)) return;

            const user = await mongoose.connection.collection('users').findOne(
                { _id: new Types.ObjectId(recipientId) },
                { projection: { email: 1, name: 1 } }
            );

            if (!user || !user.email) return;

            const appUrl = env.APP_URL || 'http://localhost:3000';
            const actionUrl = notification.actionUrl
                ? (notification.actionUrl.startsWith('http') ? notification.actionUrl : `${appUrl}${notification.actionUrl}`)
                : appUrl;

            const title = notification.title || 'New Notification';
            const message = notification.message || '';

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: #18181b; padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.5px; }
    .content { padding: 32px; color: #27272a; }
    .title { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #09090b; }
    .message { font-size: 15px; line-height: 1.6; color: #52525b; margin-bottom: 28px; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; font-size: 14px; }
    .footer { padding: 20px 32px; background: #fafafa; border-top: 1px solid #f4f4f5; font-size: 12px; color: #a1a1aa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>WorkSphere</h1>
    </div>
    <div class="content">
      <div class="title">${title}</div>
      <div class="message">${message}</div>
      <a href="${actionUrl}" class="btn" target="_blank">View in WorkSphere</a>
    </div>
    <div class="footer">
      This is an automated notification based on your company preferences in WorkSphere.
    </div>
  </div>
</body>
</html>
`;

            const transporter = getMailTransporter();
            await transporter.sendMail({
                from: mailDefaults.from,
                to: user.email,
                subject: `[WorkSphere] ${title}`,
                html,
                text: `${title}\n\n${message}\n\nView here: ${actionUrl}`,
            });
        } catch (err) {
            console.error('[EmailNotificationChannel] Failed to send email notification:', err);
        }
    }
}
