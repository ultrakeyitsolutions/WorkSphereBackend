import { getMailTransporter, mailDefaults } from '../../../config/mail';

export class AccountRecoveryEmailService {
    /**
     * Send email acknowledging receipt of account recovery request
     */
    static async sendRequestReceivedEmail(
        toEmail: string,
        requestId: string,
        userName?: string
    ): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Account Recovery Request Received';
            const name = userName || 'User';

            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .wrapper { max-width: 540px; margin: 32px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .body { padding: 32px; }
    .body h2 { color: #0f172a; margin-top: 0; font-size: 18px; }
    .body p { color: #475569; line-height: 1.6; font-size: 14px; margin: 12px 0; }
    .info-box { background: #f1f5f9; border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 13px; color: #334155; }
    .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>WorkSphere Security</h1>
    </div>
    <div class="body">
      <h2>Hello ${name},</h2>
      <p>We received an account recovery request for your WorkSphere account associated with <strong>${toEmail}</strong>.</p>
      
      <div class="info-box">
        <strong>Request Reference:</strong> <code>${requestId}</code><br/>
        <strong>Status:</strong> Pending Administrative Review
      </div>

      <p>Our SuperAdmin review team will inspect your request to verify eligibility. Once reviewed, you will receive an update at this communication address.</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you did not initiate this request, please contact our security team immediately at support@worksphere.com.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} WorkSphere. All rights reserved.
    </div>
  </div>
</body>
</html>
            `;

            await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            return true;
        } catch (error) {
            console.error('[AccountRecoveryEmailService] Failed to send request received email:', error);
            return false;
        }
    }

    /**
     * Send email with single-use verification link when SuperAdmin approves recovery
     */
    static async sendApprovalEmail(
        toEmail: string,
        requestId: string,
        recoveryUrl: string,
        expiresAt: Date,
        userName?: string
    ): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Your Account Recovery Has Been Approved';
            const name = userName || 'User';
            const expiresFormatted = expiresAt.toUTCString();

            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .wrapper { max-width: 540px; margin: 32px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .body { padding: 32px; }
    .body h2 { color: #0f172a; margin-top: 0; font-size: 18px; }
    .body p { color: #475569; line-height: 1.6; font-size: 14px; margin: 12px 0; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 13px 30px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; }
    .expiry-note { font-size: 12px; color: #dc2626; font-weight: 600; margin-top: 14px; }
    .link-box { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 10px; font-size: 11px; word-break: break-all; color: #64748b; margin-top: 12px; }
    .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>WorkSphere Security</h1>
    </div>
    <div class="body">
      <h2>Hello ${name},</h2>
      <p>Great news! Your account recovery request (Ref: <code>${requestId}</code>) has been approved by our SuperAdmin review team.</p>
      
      <p>To finalize the restoration of your account, click the button below to verify your ownership. Once verified, your account will be restored to an active state.</p>
      
      <div class="btn-wrap">
        <a href="${recoveryUrl}" class="btn" target="_blank" rel="noopener noreferrer">Complete Account Recovery</a>
      </div>

      <p class="expiry-note">⏰ This recovery link is single-use and will expire on ${expiresFormatted}.</p>

      <p style="font-size: 12px; color: #64748b;">If the button above does not work, copy and paste this secure link into your browser:</p>
      <div class="link-box">${recoveryUrl}</div>

      <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you did not request account recovery, please ignore this email or contact support@worksphere.com immediately. Your account will not be restored without clicking this link.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} WorkSphere. All rights reserved.
    </div>
  </div>
</body>
</html>
            `;

            await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            return true;
        } catch (error) {
            console.error('[AccountRecoveryEmailService] Failed to send approval email:', error);
            return false;
        }
    }

    /**
     * Send email when SuperAdmin rejects account recovery
     */
    static async sendRejectionEmail(
        toEmail: string,
        requestId: string,
        adminReason?: string,
        userName?: string
    ): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Update on Your Account Recovery Request';
            const name = userName || 'User';

            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .wrapper { max-width: 540px; margin: 32px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; }
    .body { padding: 32px; }
    .body h2 { color: #0f172a; margin-top: 0; font-size: 18px; }
    .body p { color: #475569; line-height: 1.6; font-size: 14px; margin: 12px 0; }
    .reason-box { background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 13px; color: #991b1b; }
    .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>WorkSphere Security</h1>
    </div>
    <div class="body">
      <h2>Hello ${name},</h2>
      <p>We are writing to provide an update regarding your account recovery request (Ref: <code>${requestId}</code>).</p>
      
      <p>After careful review by our administrative security team, we are unable to approve this recovery request at this time.</p>

      ${adminReason ? `<div class="reason-box"><strong>Reason:</strong> ${adminReason}</div>` : ''}

      <p>If you believe this decision was made in error or if you have additional proof of account ownership, please contact our support desk directly at <strong>support@worksphere.com</strong>.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} WorkSphere. All rights reserved.
    </div>
  </div>
</body>
</html>
            `;

            await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            return true;
        } catch (error) {
            console.error('[AccountRecoveryEmailService] Failed to send rejection email:', error);
            return false;
        }
    }

    /**
     * Send email confirming that account has been restored
     */
    static async sendRestoredEmail(toEmail: string, userName?: string): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Your Account Has Been Restored';
            const name = userName || 'User';

            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .wrapper { max-width: 540px; margin: 32px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
    .header { background: #0f172a; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; }
    .body { padding: 32px; }
    .body h2 { color: #0f172a; margin-top: 0; font-size: 18px; }
    .body p { color: #475569; line-height: 1.6; font-size: 14px; margin: 12px 0; }
    .success-box { background: #f0fdf4; border: 1px solid #dcfce7; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 13px; color: #166534; font-weight: 500; }
    .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>WorkSphere Security</h1>
    </div>
    <div class="body">
      <h2>Hello ${name},</h2>
      <div class="success-box">
        ✅ Your WorkSphere account has been successfully restored to Active status!
      </div>
      <p>You can now log in using your original email address and password.</p>
      <p>For your security, all previously active sessions have been invalidated, and you will need to sign in afresh.</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you did not perform this account restoration, please contact our emergency security team immediately at security@worksphere.com.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} WorkSphere. All rights reserved.
    </div>
  </div>
</body>
</html>
            `;

            await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            return true;
        } catch (error) {
            console.error('[AccountRecoveryEmailService] Failed to send restored email:', error);
            return false;
        }
    }
}
