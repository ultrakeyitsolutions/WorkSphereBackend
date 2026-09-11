import crypto from 'crypto';
import QRCode from 'qrcode';
import speakeasy from 'speakeasy';
import argon2 from 'argon2';
import { Types } from 'mongoose';
import { Request } from 'express';
import { User } from '../../users/user.model';
import { UserMfa } from './mfa-record.model';
import { MfaChallenge } from './mfa-challenge.model';
import { encrypt, decrypt } from '../../../utils/encryption';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { getMailTransporter, mailDefaults } from '../../../config/mail';

export class MfaService {
    /**
     * Generate 8 recovery codes in format ABCD-1234
     */
    private static generateRecoveryCodesList(count = 8): string[] {
        const codes: string[] = [];
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // avoiding ambiguous characters like 0, O, 1, I

        for (let i = 0; i < count; i++) {
            let part1 = '';
            let part2 = '';
            const randomBytes1 = crypto.randomBytes(4);
            const randomBytes2 = crypto.randomBytes(4);
            for (let j = 0; j < 4; j++) {
                part1 += chars[randomBytes1[j] % chars.length];
                part2 += chars[randomBytes2[j] % chars.length];
            }
            codes.push(`${part1}-${part2}`);
        }
        return codes;
    }

    /**
     * Send manual entry secret key to user's registered email address
     */
    static async sendManualKeyEmail(toEmail: string, secretKey: string, userName?: string): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'Your WorkSphere MFA Manual Setup Key';
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
    .wrapper { max-width: 560px; margin: 32px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
    .header { background: #0f172a; padding: 28px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .body { padding: 32px; }
    .body h2 { color: #0f172a; margin-top: 0; font-size: 18px; }
    .body p { color: #475569; line-height: 1.6; font-size: 14px; margin: 12px 0; }
    .key-box { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0; }
    .key-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 1px; margin-bottom: 6px; }
    .key-value { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 22px; font-weight: 700; color: #0f172a; letter-spacing: 2px; word-break: break-all; }
    .steps { background: #f8fafc; border-radius: 8px; padding: 16px 20px; margin: 20px 0; font-size: 13px; color: #334155; }
    .steps ol { margin: 8px 0 0 18px; padding: 0; }
    .steps li { margin: 6px 0; }
    .warning { color: #dc2626; font-size: 12px; font-weight: 600; margin-top: 16px; }
    .footer { background: #f8fafc; padding: 18px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>WorkSphere Security</h1>
    </div>
    <div class="body">
      <h2>Hello ${name},</h2>
      <p>You requested to set up Multi-Factor Authentication (MFA) for your WorkSphere account.</p>
      <p>If you cannot scan the QR code with your phone camera, use the following manual key in <strong>Microsoft Authenticator</strong>:</p>
      
      <div class="key-box">
        <div class="key-label">Manual Setup Key</div>
        <div class="key-value">${secretKey}</div>
      </div>

      <div class="steps">
        <strong>How to add manually:</strong>
        <ol>
          <li>Open <strong>Microsoft Authenticator</strong> on your mobile device.</li>
          <li>Tap <strong>+</strong> (Add account) &rarr; Choose <strong>Other account</strong>.</li>
          <li>Tap <strong>"Or enter code manually"</strong> at the bottom of the scanner screen.</li>
          <li>Enter Account Name: <strong>WorkSphere</strong></li>
          <li>Enter Secret Key: Paste or type the key above.</li>
          <li>Tap <strong>Finish</strong>.</li>
        </ol>
      </div>

      <p class="warning">⚠️ Security Notice: Never share this key with anyone. WorkSphere staff will never ask for your setup key.</p>
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
            console.error('[MfaService] Failed to send manual key email:', error);
            return false;
        }
    }

    /**
     * Send or re-send the manual setup key to user's registered email
     */
    static async sendManualKeyToEmail(userId: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });
        if (!mfaRecord || !mfaRecord.secretEncrypted) {
            throw new Error('MFA setup is not initialized. Please initiate setup first.');
        }

        const plainSecret = decrypt(mfaRecord.secretEncrypted);
        const emailSent = await this.sendManualKeyEmail(user.email, plainSecret, user.name);

        if (!emailSent) {
            throw new Error('Failed to send email. Please check your email configuration.');
        }

        return {
            emailSent: true,
            sentToEmail: user.email,
            message: `Manual backup key has been sent to ${user.email}`,
        };
    }

    /**
     * Step 1: Initiate MFA setup
     * Generates a secure TOTP secret, encrypts it, generates an otpauth:// URI, QR code,
     * and sends the manual key directly to user's registered email.
     */
    static async generateSetup(userId: string, userEmail: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Generate base32 secret and otpauth URL using speakeasy (pure CommonJS)
        const secretObj = speakeasy.generateSecret({
            name: `WorkSphere (${userEmail})`,
            issuer: 'WorkSphere',
            length: 20,
        });

        const secret = secretObj.base32;
        const otpauthUrl = secretObj.otpauth_url || `otpauth://totp/WorkSphere:${encodeURIComponent(userEmail)}?secret=${secret}&issuer=WorkSphere`;
        const secretEncrypted = encrypt(secret);

        // Store or update pending MFA record
        await UserMfa.findOneAndUpdate(
            { userId: new Types.ObjectId(userId) },
            {
                userId: new Types.ObjectId(userId),
                method: 'totp',
                secretEncrypted,
                enabledAt: null,
            },
            { upsert: true, new: true }
        );

        // Generate high-resolution QR code data URL
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 300,
        });

        // Automatically dispatch manual key to user's email address
        const emailSent = await this.sendManualKeyEmail(userEmail, secret, user.name);

        await AuditLogService.log({
            action: AuditAction.MFA_SETUP_INITIATED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `MFA setup initiated for user: ${user.email} (manual key sent to email)`,
            req,
        });

        return {
            qrCodeDataUrl,
            otpauthUrl,
            emailSent,
            sentToEmail: userEmail,
        };
    }

    /**
     * Step 2: Verify first code during setup and enable MFA
     */
    static async verifySetup(userId: string, code: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const mfaRecord = await UserMfa.findOne({ userId: new Types.ObjectId(userId) });
        if (!mfaRecord || !mfaRecord.secretEncrypted) {
            throw new Error('MFA setup has not been initiated. Please start setup again.');
        }

        const plainSecret = decrypt(mfaRecord.secretEncrypted);
        const isValid = speakeasy.totp.verify({
            secret: plainSecret,
            encoding: 'base32',
            token: code,
            window: 1, // allows ±30s clock drift
        });

        if (!isValid) {
            throw new Error('Invalid verification code. Please check Microsoft Authenticator and try again.');
        }

        // Generate 8 recovery codes
        const plainRecoveryCodes = this.generateRecoveryCodesList(8);
        const recoveryCodeHashes = await Promise.all(
            plainRecoveryCodes.map((rc) => argon2.hash(rc))
        );

        // Mark MFA as enabled
        mfaRecord.enabledAt = new Date();
        mfaRecord.recoveryCodeHashes = recoveryCodeHashes;
        await mfaRecord.save();

        user.mfaEnabled = true;
        await user.save();

        await AuditLogService.log({
            action: AuditAction.MFA_ENABLED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `MFA successfully enabled for user: ${user.email}`,
            req,
        });

        return {
            mfaEnabled: true,
            recoveryCodes: plainRecoveryCodes,
            message: 'MFA has been successfully enabled. Store these recovery codes securely.',
        };
    }

    /**
     * Create an MFA login challenge
     */
    static async createChallenge(
        userId: string | Types.ObjectId,
        purpose: 'LOGIN' | 'PASSWORD_RESET' = 'LOGIN'
    ): Promise<string> {
        const challengeId = crypto.randomUUID();
        // Challenge valid for 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await MfaChallenge.create({
            userId: new Types.ObjectId(userId),
            challengeId,
            purpose,
            expiresAt,
            attempts: 0,
            maxAttempts: 5,
            usedAt: null,
        });

        return challengeId;
    }

    /**
     * Verify MFA challenge using 6-digit TOTP code
     */
    static async verifyChallenge(challengeId: string, code: string, req?: Request) {
        const challenge = await MfaChallenge.findOne({ challengeId });
        if (!challenge) {
            throw new Error('MFA challenge not found or expired. Please login again.');
        }

        if (challenge.usedAt) {
            throw new Error('This MFA challenge has already been used. Please login again.');
        }

        if (challenge.expiresAt < new Date()) {
            throw new Error('MFA challenge has expired. Please login again.');
        }

        if (challenge.attempts >= challenge.maxAttempts) {
            throw new Error('Maximum verification attempts exceeded. Please login again.');
        }

        challenge.attempts += 1;
        await challenge.save();

        const user = await User.findById(challenge.userId);
        if (!user || !user.isActive) {
            throw new Error('User account is invalid or deactivated');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });
        if (!mfaRecord || !mfaRecord.secretEncrypted) {
            throw new Error('MFA configuration error. Please contact administrator.');
        }

        const plainSecret = decrypt(mfaRecord.secretEncrypted);
        const isValid = speakeasy.totp.verify({
            secret: plainSecret,
            encoding: 'base32',
            token: code,
            window: 1, // allows ±30s clock drift
        });

        if (!isValid) {
            const remaining = challenge.maxAttempts - challenge.attempts;
            await AuditLogService.log({
                action: AuditAction.MFA_VERIFY_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: `Failed MFA verification attempt for: ${user.email} (${remaining} attempts remaining)`,
                req,
            });

            if (remaining <= 0) {
                throw new Error('Maximum attempts exceeded. Challenge locked. Please login again.');
            }
            throw new Error(`Invalid 6-digit code. ${remaining} attempts remaining.`);
        }

        // Mark challenge used
        challenge.usedAt = new Date();
        await challenge.save();

        await AuditLogService.log({
            action: AuditAction.MFA_VERIFY_SUCCESS,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Successful MFA verification for user: ${user.email}`,
            req,
        });

        return { user };
    }

    /**
     * Verify using a single-use recovery code
     */
    static async verifyRecoveryCode(challengeId: string, recoveryCode: string, req?: Request) {
        const challenge = await MfaChallenge.findOne({ challengeId });
        if (!challenge) {
            throw new Error('MFA challenge not found or expired. Please login again.');
        }

        if (challenge.usedAt) {
            throw new Error('This MFA challenge has already been used. Please login again.');
        }

        if (challenge.expiresAt < new Date()) {
            throw new Error('MFA challenge has expired. Please login again.');
        }

        if (challenge.attempts >= challenge.maxAttempts) {
            throw new Error('Maximum verification attempts exceeded. Please login again.');
        }

        challenge.attempts += 1;
        await challenge.save();

        const user = await User.findById(challenge.userId);
        if (!user || !user.isActive) {
            throw new Error('User account is invalid or deactivated');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });
        if (!mfaRecord || !mfaRecord.recoveryCodeHashes || mfaRecord.recoveryCodeHashes.length === 0) {
            throw new Error('No recovery codes configured for this account.');
        }

        const normalizedCode = recoveryCode.trim().toUpperCase();
        let matchedIndex = -1;

        for (let i = 0; i < mfaRecord.recoveryCodeHashes.length; i++) {
            const isMatch = await argon2.verify(mfaRecord.recoveryCodeHashes[i], normalizedCode);
            if (isMatch) {
                matchedIndex = i;
                break;
            }
        }

        if (matchedIndex === -1) {
            const remaining = challenge.maxAttempts - challenge.attempts;
            await AuditLogService.log({
                action: AuditAction.MFA_VERIFY_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: `Failed recovery code verification for: ${user.email} (${remaining} attempts remaining)`,
                req,
            });

            if (remaining <= 0) {
                throw new Error('Maximum attempts exceeded. Challenge locked. Please login again.');
            }
            throw new Error(`Invalid recovery code. ${remaining} attempts remaining.`);
        }

        // Single-use: remove matched recovery code hash
        mfaRecord.recoveryCodeHashes.splice(matchedIndex, 1);
        await mfaRecord.save();

        // Mark challenge used
        challenge.usedAt = new Date();
        await challenge.save();

        await AuditLogService.log({
            action: AuditAction.MFA_RECOVERY_USED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Recovery code used for login: ${user.email}. Remaining codes: ${mfaRecord.recoveryCodeHashes.length}`,
            req,
        });

        return { user, remainingRecoveryCodes: mfaRecord.recoveryCodeHashes.length };
    }

    /**
     * Regenerate new recovery codes (when logged in and MFA is enabled)
     */
    static async regenerateRecoveryCodes(userId: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user || !user.mfaEnabled) {
            throw new Error('MFA is not enabled on this account.');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });
        if (!mfaRecord) {
            throw new Error('MFA record not found.');
        }

        const newPlainCodes = this.generateRecoveryCodesList(8);
        const recoveryCodeHashes = await Promise.all(
            newPlainCodes.map((rc) => argon2.hash(rc))
        );

        mfaRecord.recoveryCodeHashes = recoveryCodeHashes;
        await mfaRecord.save();

        await AuditLogService.log({
            action: AuditAction.MFA_RECOVERY_CODES_REGENERATED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Recovery codes regenerated for user: ${user.email}`,
            req,
        });

        return {
            recoveryCodes: newPlainCodes,
            message: 'New recovery codes generated. Previous recovery codes are now invalid.',
        };
    }

    /**
     * Disable MFA for user (requires current 6-digit code or admin action)
     */
    static async disableMfa(userId: string, code: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (!user.mfaEnabled) {
            throw new Error('MFA is not enabled on this account.');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });
        if (!mfaRecord || !mfaRecord.secretEncrypted) {
            throw new Error('MFA record not found.');
        }

        const plainSecret = decrypt(mfaRecord.secretEncrypted);
        const isValid = speakeasy.totp.verify({
            secret: plainSecret,
            encoding: 'base32',
            token: code,
            window: 1,
        });

        if (!isValid) {
            throw new Error('Invalid verification code. Could not disable MFA.');
        }

        await UserMfa.deleteOne({ userId: user._id });
        user.mfaEnabled = false;
        await user.save();

        await AuditLogService.log({
            action: AuditAction.MFA_DISABLED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `MFA disabled for user: ${user.email}`,
            req,
        });

        return {
            mfaEnabled: false,
            message: 'Multi-factor authentication has been disabled.',
        };
    }

    /**
     * Get MFA status for current user
     */
    static async getMfaStatus(userId: string) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const mfaRecord = await UserMfa.findOne({ userId: user._id });

        return {
            mfaEnabled: !!user.mfaEnabled,
            enabledAt: mfaRecord?.enabledAt || null,
            method: mfaRecord ? 'totp' : null,
            hasRecoveryCodes: (mfaRecord?.recoveryCodeHashes?.length || 0) > 0,
            remainingRecoveryCodes: mfaRecord?.recoveryCodeHashes?.length || 0,
        };
    }
}
