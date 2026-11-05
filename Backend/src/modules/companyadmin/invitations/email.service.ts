import { env } from '../../../config/env';
import { getMailTransporter } from '../../../config/mail';
import { CompanyEmailService } from '../settings/company-email.service';

export interface SendInvitationEmailOptions {
  to: string;
  rawToken: string;
  companyName: string;
  roleName: string;
  designationName: string;
  companyId?: string;
}

export interface SendInvitationEmailResult {
  messageId?: string;
  senderEmail: string;
  senderMode: 'PLATFORM' | 'COMPANY';
}

/**
 * Resolves the public frontend base URL for invitations.
 * Returns environment-specific URL: localhost in development, production domain in production.
 */
export async function resolveInvitationBaseUrl(companyId?: string): Promise<string> {
  // 1. If company has a verified custom domain, prefer that
  if (companyId) {
    try {
      const { WhiteLabelSettings } = await import('../../super-admin/white-label/white-label.model.js');
      const wl = await WhiteLabelSettings.findOne({ companyId }).lean();
      if (wl?.customDomain && wl?.domainVerificationStatus === 'VERIFIED') {
        const domain = wl.customDomain.trim().replace(/\/+$/, '');
        return domain.startsWith('http://') || domain.startsWith('https://')
          ? domain
          : `https://${domain}`;
      }
    } catch {}
  }

  // 2. Check APP_URL from env (strip trailing slash)
  const envUrl = (env.APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) {
    // Development: use APP_URL even if it contains localhost
    // Production: skip localhost, fall through to default
    if (env.NODE_ENV !== 'production' || !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
      return envUrl;
    }
  }

  // 3. Fallback to original platform domain
  return 'https://uworksphere.com';
}

export class EmailService {

  /**
   * Send the invitation email with centralized backend sender resolution.
   * If the company has an eligible subscription with custom email entitlement
   * and a verified company sender, uses the company sender configuration.
   * Otherwise safely falls back to the global platform sender.
   */
  static async sendInvitationEmail(opts: SendInvitationEmailOptions): Promise<SendInvitationEmailResult> {
    const { to, rawToken, companyName, roleName, designationName, companyId } = opts;

    const baseUrl = await resolveInvitationBaseUrl(companyId);
    const acceptUrl = `${baseUrl}/invite?token=${encodeURIComponent(rawToken)}`;

    // Centralized sender resolution
    const resolvedSender = await CompanyEmailService.resolveSender(companyId);

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
      &copy; ${new Date().getFullYear()} ${companyName} via WorkSphere. If you did not expect this invitation, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`;

    const transporter = resolvedSender.transporter;
    const mailOptions = {
      from: resolvedSender.from,
      to,
      replyTo: resolvedSender.replyTo || undefined,
      subject: `You're invited to join ${companyName} on WorkSphere`,
      html: htmlBody,
      text: `You have been invited to join ${companyName}.\nRole: ${roleName}\nDesignation: ${designationName}\n\nAccept your invitation: ${acceptUrl}`,
    };

    let info: any;
    let effectiveSenderEmail = resolvedSender.senderEmail;
    let effectiveSenderMode: 'PLATFORM' | 'COMPANY' = resolvedSender.mode === 'COMPANY' ? 'COMPANY' : 'PLATFORM';

    try {
      info = await transporter.sendMail(mailOptions);
    } catch (sendErr: any) {
      // Auto-fallback: If SMTP provider rejected custom From address (553 5.7.1 Sender address rejected / anti-spoofing),
      // gracefully retry using the platform's authenticated sender while preserving the company Reply-To.
      const isSenderRejected =
        sendErr?.responseCode === 553 ||
        (typeof sendErr?.message === 'string' &&
          (sendErr.message.includes('553') ||
            sendErr.message.includes('Sender address rejected') ||
            sendErr.message.includes('not owned by user')));

      if (resolvedSender.mode !== 'PLATFORM' && isSenderRejected) {
        console.warn(
          `[EmailService] Mail provider rejected custom From address (${resolvedSender.from}). Retrying with platform authorized sender.`
        );
        const fallbackTransporter = getMailTransporter();
        info = await fallbackTransporter.sendMail({
          ...mailOptions,
          from: `"${resolvedSender.senderName}" <${env.MAIL_FROM_ADDRESS}>`,
          replyTo: resolvedSender.replyTo || resolvedSender.senderEmail,
        });
        effectiveSenderEmail = env.MAIL_FROM_ADDRESS;
        effectiveSenderMode = 'PLATFORM';
      } else {
        throw sendErr;
      }
    }

    // nodemailer returns messageId for smtp, envelope for jsonTransport
    const messageId = info?.messageId ?? info?.envelope?.to?.[0];

    return {
      messageId,
      senderEmail: effectiveSenderEmail,
      senderMode: effectiveSenderMode,
    };
  }
}
