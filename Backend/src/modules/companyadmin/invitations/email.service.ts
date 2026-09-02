import { getMailTransporter, mailDefaults } from '../../../config/mail';
import { env } from '../../../config/env';

export interface SendInvitationEmailOptions {
  to: string;
  rawToken: string;
  companyName: string;
  roleName: string;
  designationName: string;
}

export class EmailService {

  /**
   * Send the invitation email.
   * The raw token is embedded in the URL — it is NEVER returned from the API.
   */
  static async sendInvitationEmail(opts: SendInvitationEmailOptions): Promise<string | undefined> {
    const { to, rawToken, companyName, roleName, designationName } = opts;

    const acceptUrl = `${env.APP_URL}/invite?token=${encodeURIComponent(rawToken)}`;

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to join ${companyName}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header  { background: #1a1a2e; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; }
    .body    { padding: 40px; }
    .body h2 { color: #1a1a2e; margin-top: 0; }
    .body p  { color: #4b4b6b; line-height: 1.6; }
    .badge   { display: inline-block; background: #f0f0f8; border-radius: 4px; padding: 4px 12px; font-size: 13px; color: #333; margin: 4px 0; }
    .cta     { text-align: center; margin: 36px 0; }
    .cta a   { display: inline-block; background: #f97316; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 16px; font-weight: bold; }
    .footer  { background: #f4f4f5; padding: 20px 40px; text-align: center; font-size: 12px; color: #9ca3af; }
    .footer a { color: #6366f1; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${companyName}</h1>
    </div>
    <div class="body">
      <h2>You've been invited! 🎉</h2>
      <p>You have been invited to join <strong>${companyName}</strong> on WorkSphere.</p>
      <p>
        <strong>Role:</strong> <span class="badge">${roleName}</span><br/>
        <strong>Designation:</strong> <span class="badge">${designationName}</span>
      </p>
      <p>This invitation will expire in <strong>${env.INVITATION_EXPIRES_DAYS} days</strong>. Click the button below to accept.</p>
      <div class="cta">
        <a href="${acceptUrl}" target="_blank">Accept Invitation</a>
      </div>
      <p style="font-size:13px; color:#6b7280;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${acceptUrl}">${acceptUrl}</a>
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} WorkSphere. If you did not expect this invitation, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`;

    const transporter = getMailTransporter();
    const info = await transporter.sendMail({
      from: mailDefaults.from,
      to,
      subject: `You're invited to join ${companyName} on WorkSphere`,
      html: htmlBody,
      text: `You have been invited to join ${companyName}.\nRole: ${roleName}\nDesignation: ${designationName}\n\nAccept your invitation: ${acceptUrl}`,
    });

    // nodemailer returns messageId for smtp, envelope for jsonTransport
    return (info as any).messageId ?? (info as any).envelope?.to?.[0];
  }
}
