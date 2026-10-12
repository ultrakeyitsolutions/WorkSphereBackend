import crypto from 'crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { Types } from 'mongoose';
import { Request } from 'express';
import { CompanySettings, DEFAULT_EMAIL_SETTINGS } from './company-settings.model';
import { Company } from '../../super-admin/companies/company.model';
import { User } from '../../users/user.model';
import { AppError } from '../../../utils/AppError';
import { encrypt, decrypt } from '../../../utils/encryption';
import { env } from '../../../config/env';
import { getMailTransporter, mailDefaults } from '../../../config/mail';
import { CompanyEmailEntitlementService } from './company-email-entitlement.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import {
    UpdateCompanyEmailDto,
    SanitizedCompanyEmailSettings,
    EmailMode,
} from './company-email.types';

export interface ResolvedSender {
    transporter: Transporter;
    from: string;
    replyTo?: string | null;
    senderEmail: string;
    senderName: string;
    mode: EmailMode | 'PLATFORM_AUTHORIZED_SENDER';
}

export class CompanyEmailService {

    /**
     * Resolves the authoritative mail sender and transporter for a given company.
     * Central resolution flow:
     * 1. Check company subscription and CUSTOM_COMPANY_EMAIL entitlement.
     * 2. If entitled and company email is verified + configured:
     *    - If custom SMTP credentials exist: creates an authorized company transporter.
     *    - If no custom SMTP: uses authorized platform transporter with provider-safe sender and company Reply-To.
     * 3. Otherwise: safely falls back to the global platform sender.
     */
    static async resolveSender(companyId?: string): Promise<ResolvedSender> {
        const fallbackPlatform: ResolvedSender = {
            transporter: getMailTransporter(),
            from: mailDefaults.from,
            replyTo: undefined,
            senderEmail: env.MAIL_FROM_ADDRESS,
            senderName: env.MAIL_FROM_NAME,
            mode: 'PLATFORM',
        };

        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            return fallbackPlatform;
        }

        try {
            // 1. Check Entitlement
            const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
            if (!entitlement.isEntitled) {
                return fallbackPlatform;
            }

            // 2. Load Settings & Company Details
            const companyObjId = new Types.ObjectId(companyId);
            const [settings, company] = await Promise.all([
                CompanySettings.findOne({ companyId: companyObjId }).lean(),
                Company.findById(companyObjId).lean(),
            ]);

            const emailConfig = settings?.email;
            if (
                !emailConfig ||
                emailConfig.mode !== 'COMPANY' ||
                !emailConfig.isVerified ||
                !emailConfig.senderEmail
            ) {
                return fallbackPlatform;
            }

            const senderEmail = emailConfig.senderEmail.trim();
            const senderName = (emailConfig.senderName?.trim()) || company?.name || env.MAIL_FROM_NAME;
            const replyTo = emailConfig.replyTo?.trim() || senderEmail;

            // 3. Custom SMTP Transporter
            if (emailConfig.smtp?.host && emailConfig.smtp?.passwordEncrypted) {
                try {
                    const decryptedPassword = decrypt(emailConfig.smtp.passwordEncrypted);
                    const customTransporter = nodemailer.createTransport({
                        host: emailConfig.smtp.host,
                        port: emailConfig.smtp.port,
                        secure: Boolean(emailConfig.smtp.secure),
                        auth: {
                            user: emailConfig.smtp.username,
                            pass: decryptedPassword,
                        },
                        connectionTimeout: 10000,
                        greetingTimeout: 10000,
                        socketTimeout: 15000,
                        tls: {
                            rejectUnauthorized: env.NODE_ENV === 'production',
                        },
                    });

                    return {
                        transporter: customTransporter,
                        from: `"${senderName}" <${senderEmail}>`,
                        replyTo,
                        senderEmail,
                        senderName,
                        mode: 'COMPANY',
                    };
                } catch {
                    // Decryption / transport construction error -> fallback safely to platform
                    return fallbackPlatform;
                }
            }

            // 4. Platform Transporter with Verified Sender or Provider-Safe Sender
            // Unless explicitly disallowed with MAIL_ALLOW_CUSTOM_FROM=false:
            const disallowCustomFrom = process.env.MAIL_ALLOW_CUSTOM_FROM === 'false';
            if (!disallowCustomFrom) {
                return {
                    transporter: getMailTransporter(),
                    from: `"${senderName}" <${senderEmail}>`,
                    replyTo,
                    senderEmail,
                    senderName,
                    mode: 'COMPANY',
                };
            }

            // If global SMTP provider restricts From spoofing, use verified platform address with company identity & Reply-To
            return {
                transporter: getMailTransporter(),
                from: `"${senderName} via WorkSphere" <${env.MAIL_FROM_ADDRESS}>`,
                replyTo,
                senderEmail,
                senderName,
                mode: 'PLATFORM_AUTHORIZED_SENDER',
            };

        } catch {
            return fallbackPlatform;
        }
    }

    /**
     * Retrieve current company email configuration and entitlement diagnostics.
     */
    static async getEmailSettings(companyId: string): Promise<{
        entitlement: Awaited<ReturnType<typeof CompanyEmailEntitlementService.checkEntitlement>>;
        settings: SanitizedCompanyEmailSettings;
    }> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
        const settingsDoc = await CompanySettings.findOne({ companyId: new Types.ObjectId(companyId) }).lean();
        const emailConfig = settingsDoc?.email || { ...DEFAULT_EMAIL_SETTINGS };
        const resolvedSender = await this.resolveSender(companyId);

        const hasPendingVerification = Boolean(
            emailConfig.verificationCodeHash &&
            emailConfig.verificationCodeExpiresAt &&
            new Date() < new Date(emailConfig.verificationCodeExpiresAt)
        );

        const sanitizedSmtp = emailConfig.smtp?.host
            ? {
                host: emailConfig.smtp.host,
                port: emailConfig.smtp.port,
                secure: Boolean(emailConfig.smtp.secure),
                username: emailConfig.smtp.username,
                hasPassword: Boolean(emailConfig.smtp.passwordEncrypted),
            }
            : null;

        return {
            entitlement,
            settings: {
                mode: emailConfig.mode || 'PLATFORM',
                senderEmail: emailConfig.senderEmail || null,
                senderName: emailConfig.senderName || null,
                replyTo: emailConfig.replyTo || null,
                isVerified: Boolean(emailConfig.isVerified),
                verifiedAt: emailConfig.verifiedAt ? new Date(emailConfig.verifiedAt) : null,
                verificationPending: hasPendingVerification,
                smtp: sanitizedSmtp,
                platformDefault: {
                    senderEmail: env.MAIL_FROM_ADDRESS,
                    senderName: env.MAIL_FROM_NAME,
                },
                effectiveSender: {
                    mode: resolvedSender.mode,
                    from: resolvedSender.from,
                    replyTo: resolvedSender.replyTo,
                    description:
                        resolvedSender.mode === 'COMPANY'
                            ? 'Sending from verified custom company email address.'
                            : resolvedSender.mode === 'PLATFORM_AUTHORIZED_SENDER'
                              ? 'Sending from platform address with company Reply-To header.'
                              : 'Sending from default WorkSphere platform email configuration.',
                },
            },
        };
    }

    /**
     * Configure or update company email settings.
     * Enforces subscription entitlement, encrypts SMTP credentials, and resets verification on address changes.
     */
    static async updateEmailSettings(
        companyId: string,
        dto: UpdateCompanyEmailDto,
        updatedByUserId: string,
        req?: Request
    ): Promise<SanitizedCompanyEmailSettings> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        // 1. Guard Entitlement
        const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company email is not included in your organization\'s subscription plan.'
            );
        }

        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = updatedByUserId && Types.ObjectId.isValid(updatedByUserId)
            ? new Types.ObjectId(updatedByUserId)
            : null;

        const company = await Company.findById(companyObjId);
        if (!company) {
            throw AppError.notFound('Company not found');
        }

        let existingSettings = await CompanySettings.findOne({ companyId: companyObjId });
        if (!existingSettings) {
            existingSettings = await CompanySettings.create({
                companyId: companyObjId,
                email: { ...DEFAULT_EMAIL_SETTINGS },
            });
        }

        const currentEmailConfig = existingSettings.email || { ...DEFAULT_EMAIL_SETTINGS };

        // 2. Detect sender email changes (requires re-verification)
        const incomingEmail = dto.senderEmail ? dto.senderEmail.trim().toLowerCase() : undefined;
        const currentEmail = currentEmailConfig.senderEmail ? currentEmailConfig.senderEmail.trim().toLowerCase() : undefined;
        const emailChanged = incomingEmail !== undefined && incomingEmail !== currentEmail;

        const isVerified = emailChanged ? false : Boolean(currentEmailConfig.isVerified);
        const verifiedAt = emailChanged ? null : (currentEmailConfig.verifiedAt || null);

        // 3. Process SMTP settings & encrypt password
        let updatedSmtp: any = currentEmailConfig.smtp || null;

        if (dto.smtp !== undefined) {
            if (dto.smtp === null) {
                updatedSmtp = null;
            } else {
                let passwordEncrypted = currentEmailConfig.smtp?.passwordEncrypted;
                if (dto.smtp.password) {
                    passwordEncrypted = encrypt(dto.smtp.password);
                }

                updatedSmtp = {
                    host: dto.smtp.host.trim(),
                    port: dto.smtp.port,
                    secure: Boolean(dto.smtp.secure),
                    username: dto.smtp.username.trim(),
                    passwordEncrypted,
                };
            }
        }

        // 4. Determine mode
        // If COMPANY mode is requested but email is not verified, set to PLATFORM or keep unverified with mode COMPANY
        const mode: EmailMode = dto.mode || currentEmailConfig.mode || 'PLATFORM';

        const updatedEmailConfig = {
            mode,
            senderEmail: incomingEmail !== undefined ? incomingEmail : currentEmailConfig.senderEmail,
            senderName: dto.senderName !== undefined ? dto.senderName.trim() : currentEmailConfig.senderName,
            replyTo: dto.replyTo !== undefined ? dto.replyTo.trim().toLowerCase() : currentEmailConfig.replyTo,
            isVerified,
            verifiedAt,
            verificationCodeHash: emailChanged ? null : currentEmailConfig.verificationCodeHash,
            verificationCodeExpiresAt: emailChanged ? null : currentEmailConfig.verificationCodeExpiresAt,
            verificationAttempts: emailChanged ? 0 : currentEmailConfig.verificationAttempts,
            smtp: updatedSmtp,
            updatedAt: new Date(),
            updatedBy: userObjId,
        };

        existingSettings.email = updatedEmailConfig as any;
        await existingSettings.save();

        CompanyEmailEntitlementService.invalidateCache(companyId);

        // 5. Record Audit Log (Omit secrets!)
        try {
            await AuditLogService.log({
                action: AuditAction.COMPANY_EMAIL_CONFIG_UPDATED,
                actorId: updatedByUserId || null,
                companyId: String(companyObjId),
                companyName: company.name,
                metadata: {
                    mode: updatedEmailConfig.mode,
                    senderEmail: updatedEmailConfig.senderEmail,
                    senderName: updatedEmailConfig.senderName,
                    hasSmtp: Boolean(updatedSmtp?.host),
                    smtpHost: updatedSmtp?.host || null,
                    smtpPort: updatedSmtp?.port || null,
                    isVerified: updatedEmailConfig.isVerified,
                },
                success: true,
                description: `Company invitation email settings updated by user ${updatedByUserId}`,
                req,
            });
        } catch {
            // Non-critical audit failure
        }

        const fullConfig = await this.getEmailSettings(companyId);
        return fullConfig.settings;
    }

    /**
     * Generate and dispatch a 6-digit verification code to the configured sender email.
     */
    static async sendVerificationCode(
        companyId: string,
        userId: string,
        req?: Request
    ): Promise<{ message: string; expiresAt: Date; senderEmail: string }> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company email is not included in your organization\'s subscription plan.'
            );
        }

        const companyObjId = new Types.ObjectId(companyId);
        const settings = await CompanySettings.findOne({ companyId: companyObjId });
        if (!settings || !settings.email?.senderEmail) {
            throw AppError.badRequest('Please configure a sender email address before requesting verification.');
        }

        const senderEmail = settings.email.senderEmail.trim().toLowerCase();
        const company = await Company.findById(companyObjId);
        const companyName = company?.name || 'Your Company';

        // Cryptographically secure 6-digit code
        const rawCode = crypto.randomInt(100000, 999999).toString();
        const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

        settings.email.verificationCodeHash = codeHash;
        settings.email.verificationCodeExpiresAt = expiresAt;
        settings.email.verificationAttempts = 0;
        await settings.save();

        console.log(`[CompanyEmailService] Verification code for ${senderEmail}: ${rawCode} (Expires: ${expiresAt.toISOString()})`);

        // Send code via global platform transporter
        const transporter = getMailTransporter();
        const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px;">
    <h2 style="color: #1a1a2e; margin-top: 0;">Verify Company Email Sender</h2>
    <p style="color: #555;">You requested verification for <strong>${senderEmail}</strong> on behalf of <strong>${companyName}</strong> in WorkSphere.</p>
    <p style="color: #555;">Enter the following 6-digit verification code to confirm ownership:</p>
    <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #f97316; margin: 24px 0; text-align: center;">
      ${rawCode}
    </div>
    <p style="color: #888; font-size: 13px;">This code will expire in 15 minutes. If you did not request this, please ignore this email.</p>
  </div>
</body>
</html>`;

        await transporter.sendMail({
            from: mailDefaults.from,
            to: senderEmail,
            subject: `WorkSphere: Verify your company email address (${companyName})`,
            html,
            text: `Your WorkSphere email verification code is: ${rawCode}. This code expires in 15 minutes.`,
        });

        return {
            message: `Verification code sent to ${senderEmail}. It will expire in 15 minutes.`,
            expiresAt,
            senderEmail,
        };
    }

    /**
     * Verify ownership of the company email address by validating the submitted 6-digit code.
     */
    static async confirmVerificationCode(
        companyId: string,
        code: string,
        userId: string,
        req?: Request
    ): Promise<{ success: boolean; message: string; isVerified: boolean }> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company email is not included in your organization\'s subscription plan.'
            );
        }

        const companyObjId = new Types.ObjectId(companyId);
        const settings = await CompanySettings.findOne({ companyId: companyObjId });
        if (!settings || !settings.email) {
            throw AppError.badRequest('No email configuration found.');
        }

        const emailConfig = settings.email;
        if (!emailConfig.verificationCodeHash || !emailConfig.verificationCodeExpiresAt) {
            throw AppError.badRequest('No pending verification code found. Please request a new code.');
        }

        if (new Date() > new Date(emailConfig.verificationCodeExpiresAt)) {
            emailConfig.verificationCodeHash = null;
            emailConfig.verificationCodeExpiresAt = null;
            await settings.save();
            throw AppError.badRequest('Verification code has expired. Please request a new code.');
        }

        const attempts = (emailConfig.verificationAttempts || 0) + 1;
        if (attempts > 5) {
            emailConfig.verificationCodeHash = null;
            emailConfig.verificationCodeExpiresAt = null;
            emailConfig.verificationAttempts = 0;
            await settings.save();
            throw AppError.badRequest('Maximum verification attempts exceeded. Please request a new code.');
        }

        const inputHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
        if (inputHash !== emailConfig.verificationCodeHash) {
            emailConfig.verificationAttempts = attempts;
            await settings.save();
            throw AppError.badRequest(`Invalid verification code. ${5 - attempts} attempt(s) remaining.`);
        }

        // Verification successful
        emailConfig.isVerified = true;
        emailConfig.verifiedAt = new Date();
        emailConfig.mode = 'COMPANY';
        emailConfig.verificationCodeHash = null;
        emailConfig.verificationCodeExpiresAt = null;
        emailConfig.verificationAttempts = 0;
        await settings.save();

        CompanyEmailEntitlementService.invalidateCache(companyId);

        // Audit Log
        try {
            const company = await Company.findById(companyObjId).lean();
            await AuditLogService.log({
                action: AuditAction.COMPANY_EMAIL_VERIFIED,
                actorId: userId || null,
                companyId: String(companyObjId),
                companyName: company?.name || 'Company',
                metadata: {
                    senderEmail: emailConfig.senderEmail,
                    verifiedAt: emailConfig.verifiedAt,
                },
                success: true,
                description: `Company email address verified by user ${userId}`,
                req,
            });
        } catch {
            // Non-critical
        }

        return {
            success: true,
            message: 'Company sender email successfully verified and enabled.',
            isVerified: true,
        };
    }

    /**
     * Send a test email to verify credentials and delivery configuration.
     */
    static async sendTestEmail(
        companyId: string,
        recipientEmail?: string,
        userId?: string
    ): Promise<{ success: boolean; message: string; messageId?: string; sender: string }> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        const entitlement = await CompanyEmailEntitlementService.checkEntitlement(companyId);
        if (!entitlement.isEntitled) {
            throw AppError.forbidden(
                entitlement.message || 'Custom company email is not included in your organization\'s subscription plan.'
            );
        }

        let targetEmail = recipientEmail?.trim().toLowerCase();
        if (!targetEmail && userId && Types.ObjectId.isValid(userId)) {
            const user = await User.findById(userId).lean();
            targetEmail = user?.email;
        }

        if (!targetEmail) {
            throw AppError.badRequest('Recipient email is required for sending a test email.');
        }

        const resolved = await this.resolveSender(companyId);
        const company = await Company.findById(new Types.ObjectId(companyId)).lean();
        const companyName = company?.name || 'WorkSphere Organization';

        try {
            const info = await resolved.transporter.sendMail({
                from: resolved.from,
                to: targetEmail,
                replyTo: resolved.replyTo || undefined,
                subject: `WorkSphere: Test Invitation Email for ${companyName}`,
                html: `
<div style="font-family: Arial, sans-serif; padding: 20px; background: #f9f9fb;">
  <div style="max-width: 500px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 8px;">
    <h2>Email Configuration Test Successful 🎉</h2>
    <p>This is a test invitation email sent from <strong>${companyName}</strong>.</p>
    <p><strong>Resolved Sender:</strong> ${resolved.from}</p>
    <p><strong>Mode:</strong> ${resolved.mode}</p>
    <p style="color: #666; font-size: 13px;">Your company invitation email settings are working as expected.</p>
  </div>
</div>`,
                text: `Test invitation email for ${companyName}. Sender: ${resolved.from}. Delivery mode: ${resolved.mode}.`,
            });

            return {
                success: true,
                message: `Test email successfully dispatched to ${targetEmail}`,
                messageId: (info as any).messageId || (info as any).envelope?.to?.[0],
                sender: resolved.from,
            };
        } catch (err: any) {
            throw AppError.badRequest(`Failed to send test email: ${err?.message || 'Transport connection error'}`);
        }
    }

    /**
     * Reset company email configuration back to default platform mode.
     */
    static async resetEmailSettings(
        companyId: string,
        userId: string,
        req?: Request
    ): Promise<SanitizedCompanyEmailSettings> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company context ID');
        }

        const companyObjId = new Types.ObjectId(companyId);
        const userObjId = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;

        const settings = await CompanySettings.findOne({ companyId: companyObjId });
        if (settings) {
            settings.email = {
                ...DEFAULT_EMAIL_SETTINGS,
                updatedAt: new Date(),
                updatedBy: userObjId,
            } as any;
            await settings.save();
        }

        CompanyEmailEntitlementService.invalidateCache(companyId);

        try {
            const company = await Company.findById(companyObjId).lean();
            await AuditLogService.log({
                action: AuditAction.COMPANY_EMAIL_RESET,
                actorId: userId || null,
                companyId: String(companyObjId),
                companyName: company?.name || 'Company',
                metadata: {},
                success: true,
                description: `Company invitation email configuration reset to platform defaults by user ${userId}`,
                req,
            });
        } catch {
            // Non-critical
        }

        const fullConfig = await this.getEmailSettings(companyId);
        return fullConfig.settings;
    }
}

export default CompanyEmailService;
