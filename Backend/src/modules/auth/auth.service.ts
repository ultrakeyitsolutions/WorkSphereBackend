import crypto from 'crypto';
import argon2 from 'argon2';
import { UserService } from '../users/user.service';
import { Role } from '../roles/role.model';
import { Company } from '../super-admin/companies/company.model';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/tokens';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { Request } from 'express';
import { CompanyProfileService } from '../companyadmin/profile/company-profile.service';
import { MfaService } from './mfa/mfa.service';
import { SessionService } from './session/session.service';
import { PasswordReset } from './password-reset.model';
import { getMailTransporter, mailDefaults } from '../../config/mail';

export class AuthService {
    static async register(data: any) {
        const existingUser = await UserService.findByEmail(data.email);
        if (existingUser) {
            throw new Error('Email is already registered');
        }

        // Role resolution or creation
        const roleName = data.roleName || 'User';
        let role = await Role.findOne({ name: roleName });
        if (!role) {
            role = new Role({ name: roleName });
            await role.save();
        }

        const hashedPassword = await hashPassword(data.password);
        const user = await UserService.createUser({
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: role._id as any,
            isActive: true,
        });

        return user;
    }

    static async login(data: any, req?: Request) {
        const user = await UserService.findByEmail(data.email);
        if (!user) {
            // Log failed login attempt
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorEmail: data.email,
                success: false,
                description: `Failed login attempt for email: ${data.email} — user not found`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        if (!user.isActive) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                success: false,
                description: `Failed login — account deactivated for: ${user.email}`,
                req,
            });
            throw new Error('Your account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    success: false,
                    description: `Failed login — organization not found for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization suspended for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    companyId: String(company._id),
                    companyName: company.name,
                    success: false,
                    description: `Failed login — organization inactive for: ${user.email}`,
                    req,
                });
                throw new Error('Your organization account is no longer active.');
            }
            companyDoc = company;
        }

        const isMatch = await comparePassword(data.password, user.password || '');
        if (!isMatch) {
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: (user.role as any)?.name ?? null,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: `Failed login — wrong password for: ${user.email}`,
                req,
            });
            throw new Error('Invalid email or password');
        }

        // ─── MFA Gate ────────────────────────────────────────────────────────────
        if (user.mfaEnabled) {
            const challengeId = await MfaService.createChallenge(user._id, 'LOGIN');
            return {
                status: 'MFA_REQUIRED',
                challengeId,
            };
        }

        return this.generateAuthSessionResponse(user, req, null, companyDoc);
    }

    /**
     * Common helper to issue tokens, create an authentication session, and build the auth response
     */
    static async generateAuthSessionResponse(
        user: any,
        req?: Request,
        mfaVerifiedAt?: Date | null,
        existingCompanyDoc?: any
    ) {
        let companyDoc = existingCompanyDoc;
        if (!companyDoc && user.companyId) {
            companyDoc = await Company.findById(user.companyId);
        }

        const userRole = (user.role as any)?.name || 'User';

        const rolePermissions = ((user.role as any)?.permissions || []).map((p: any) => p.name).filter(Boolean);
        const grantedPermissions = ((user as any).grantedPermissions || []).map((p: any) => p.name).filter(Boolean);
        const revokedPermissions = ((user as any).revokedPermissions || []).map((p: any) => p.name).filter(Boolean);

        const effectivePermissionsSet = new Set(rolePermissions);
        grantedPermissions.forEach((p: string) => effectivePermissionsSet.add(p));
        revokedPermissions.forEach((p: string) => effectivePermissionsSet.delete(p));
        const finalPermissions = Array.from(effectivePermissionsSet);

        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // ─── Create Auth Session ─────────────────────────────────────────────
        await SessionService.createSession({
            userId: user._id,
            refreshToken,
            mfaVerifiedAt: mfaVerifiedAt || (user.mfaEnabled ? new Date() : null),
            req,
        });

        // ─── Successful login audit ──────────────────────────────────────────
        await AuditLogService.log({
            action: AuditAction.USER_LOGIN,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `User logged in: ${user.email}`,
            req,
        });

        const subscriptionData = companyDoc
            ? await CompanyProfileService.getCompanySubscription(String(companyDoc._id))
            : null;

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                permissions: finalPermissions,
                companyId: user.companyId,
                mfaEnabled: !!user.mfaEnabled,
            },
            company: companyDoc
                ? {
                    id: String(companyDoc._id),
                    name: companyDoc.name,
                    slug: companyDoc.slug,
                    domain: companyDoc.domain || null,
                    industry: companyDoc.industry || null,
                    size: companyDoc.size || null,
                    logoUrl: companyDoc.logoUrl || null,
                    companyEmail: companyDoc.companyEmail || null,
                    companyPhone: companyDoc.companyPhone || null,
                    website: companyDoc.website || null,
                    address: companyDoc.address || null,
                    city: companyDoc.city || null,
                    state: companyDoc.state || null,
                    country: companyDoc.country || null,
                    postalCode: companyDoc.postalCode || null,
                    timezone: companyDoc.timezone || null,
                    currency: companyDoc.currency || null,
                    status: companyDoc.status,
                    isActive: companyDoc.isActive,
                    subscription: subscriptionData,
                    createdAt: (companyDoc as any).createdAt,
                    updatedAt: (companyDoc as any).updatedAt,
                }
                : null,
            accessToken,
            refreshToken,
        };
    }

    static async refresh(token: string, req?: Request) {
        // Validate against active database session
        const activeSession = await SessionService.validateSession(token);
        if (!activeSession) {
            throw new Error('Session is invalid or has been revoked. Please log in again.');
        }

        const decoded = verifyRefreshToken(token);
        const user = await UserService.findById(decoded.userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (!user.isActive) {
            throw new Error('User account is deactivated');
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                throw new Error('Your organization account is not found.');
            }
            if (company.status === 'SUSPENDED') {
                throw new Error('Your organization account is currently suspended.');
            }
            if (company.status === 'DELETED' || !company.isActive) {
                throw new Error('Your organization account is no longer active.');
            }
            companyDoc = company;
        }

        const userRole = (user.role as any)?.name || 'User';

        const rolePermissions = ((user.role as any)?.permissions || []).map((p: any) => p.name).filter(Boolean);
        const grantedPermissions = ((user as any).grantedPermissions || []).map((p: any) => p.name).filter(Boolean);
        const revokedPermissions = ((user as any).revokedPermissions || []).map((p: any) => p.name).filter(Boolean);
        
        const effectivePermissionsSet = new Set(rolePermissions);
        grantedPermissions.forEach((p: string) => effectivePermissionsSet.add(p));
        revokedPermissions.forEach((p: string) => effectivePermissionsSet.delete(p));
        const finalPermissions = Array.from(effectivePermissionsSet);

        const payload = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        const accessToken = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        // ─── Rotate Refresh Token in Session ─────────────────────────────────
        await SessionService.rotateSessionToken(token, newRefreshToken);

        // Token refresh is the closest thing to a "logout + re-login" we track
        await AuditLogService.log({
            action: AuditAction.USER_LOGOUT,
            actorId: String(user._id),
            actorEmail: user.email,
            actorRole: userRole,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Token refreshed (session continued) for: ${user.email}`,
            metadata: { note: 'Token refresh — previous session rotated' },
            req,
        });

        const subscriptionData = companyDoc
            ? await CompanyProfileService.getCompanySubscription(String(companyDoc._id))
            : null;

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: userRole,
                permissions: finalPermissions,
                companyId: user.companyId,
                mfaEnabled: !!user.mfaEnabled,
            },
            company: companyDoc
                ? {
                    id: String(companyDoc._id),
                    name: companyDoc.name,
                    slug: companyDoc.slug,
                    domain: companyDoc.domain || null,
                    industry: companyDoc.industry || null,
                    size: companyDoc.size || null,
                    logoUrl: companyDoc.logoUrl || null,
                    companyEmail: companyDoc.companyEmail || null,
                    companyPhone: companyDoc.companyPhone || null,
                    website: companyDoc.website || null,
                    address: companyDoc.address || null,
                    city: companyDoc.city || null,
                    state: companyDoc.state || null,
                    country: companyDoc.country || null,
                    postalCode: companyDoc.postalCode || null,
                    timezone: companyDoc.timezone || null,
                    currency: companyDoc.currency || null,
                    status: companyDoc.status,
                    isActive: companyDoc.isActive,
                    subscription: subscriptionData,
                    createdAt: (companyDoc as any).createdAt,
                    updatedAt: (companyDoc as any).updatedAt,
                }
                : null,
            accessToken,
            refreshToken: newRefreshToken,
        };
    }

    /**
     * Send email containing the 6-digit numeric OTP for password reset
     */
    private static async sendPasswordResetOtpEmail(toEmail: string, otp: string, userName?: string): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Password Reset Verification Code';
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
    .otp-box { background: #f1f5f9; border: 2px dashed #0f172a; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 1px; margin-bottom: 6px; }
    .otp-code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: 6px; }
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
      <p>We received a request to reset the password for your WorkSphere account.</p>
      <p>Enter the following 6-digit verification code to reset your password:</p>
      
      <div class="otp-box">
        <div class="otp-label">Password Reset Code</div>
        <div class="otp-code">${otp}</div>
      </div>

      <p><strong>Note:</strong> This code is single-use and expires in <strong>10 minutes</strong>.</p>
      <p style="color: #dc2626; font-size: 12px; margin-top: 16px;">If you did not request a password reset, please ignore this email. Your password remains safe and unchanged.</p>
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
            console.error('[AuthService] Failed to send password reset email:', error);
            return false;
        }
    }

    /**
     * Send email notification confirming that the password has been changed
     */
    private static async sendPasswordChangedNotificationEmail(toEmail: string, userName?: string): Promise<boolean> {
        try {
            const transporter = getMailTransporter();
            const subject = 'WorkSphere: Your Password Has Been Changed';
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
      <p>This is a confirmation that the password for your WorkSphere account (${toEmail}) was successfully changed.</p>
      <p>For your security, all active sessions on your account across all devices have been signed out.</p>
      <p style="color: #dc2626; font-size: 12px; margin-top: 16px;">If you did not perform this change, please contact your company administrator immediately.</p>
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
            console.error('[AuthService] Failed to send password changed email:', error);
            return false;
        }
    }

    /**
     * Request password reset: generates 6-digit numeric OTP, hashes with Argon2, and sends email
     */
    static async requestPasswordReset(email: string, _req?: Request) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await UserService.findByEmail(normalizedEmail);

        // Security best practice: Always return generic success message to prevent user enumeration
        if (!user || !user.isActive) {
            return {
                message: 'If an account exists with this email, a 6-digit password reset code has been sent.',
            };
        }

        // Generate 6-digit numeric OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpHash = await argon2.hash(otp);

        // Code valid for 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Delete any existing reset requests for this email and create new
        await PasswordReset.deleteMany({ email: normalizedEmail });
        await PasswordReset.create({
            email: normalizedEmail,
            otpHash,
            expiresAt,
            attempts: 0,
            usedAt: null,
        });

        // Send email
        await this.sendPasswordResetOtpEmail(user.email, otp, user.name);

        return {
            message: 'If an account exists with this email, a 6-digit password reset code has been sent.',
        };
    }

    /**
     * Reset password using the 6-digit OTP code and strong password validation
     */
    static async resetPassword(data: { email: string; code: string; newPassword: string }, req?: Request) {
        const normalizedEmail = data.email.trim().toLowerCase();
        const user = await UserService.findByEmail(normalizedEmail);
        if (!user || !user.isActive) {
            throw new Error('Invalid email or reset code.');
        }

        const resetRecord = await PasswordReset.findOne({
            email: normalizedEmail,
            usedAt: null,
        }).sort({ createdAt: -1 });

        if (!resetRecord) {
            throw new Error('No active password reset request found. Please request a new code.');
        }

        if (resetRecord.expiresAt < new Date()) {
            await PasswordReset.deleteOne({ _id: resetRecord._id });
            throw new Error('The 6-digit reset code has expired (valid for 10 minutes). Please request a new code.');
        }

        if (resetRecord.attempts >= 5) {
            await PasswordReset.deleteOne({ _id: resetRecord._id });
            throw new Error('Maximum verification attempts exceeded. Please request a new code.');
        }

        resetRecord.attempts += 1;
        await resetRecord.save();

        const isMatch = await argon2.verify(resetRecord.otpHash, data.code.trim());
        if (!isMatch) {
            const remaining = 5 - resetRecord.attempts;
            throw new Error(`Invalid 6-digit reset code. ${remaining > 0 ? remaining : 0} attempts remaining.`);
        }

        // Successfully verified: mark as used immediately so it cannot be reused
        resetRecord.usedAt = new Date();
        await resetRecord.save();

        // Hash new password using Argon2id
        const hashedPassword = await hashPassword(data.newPassword);
        user.password = hashedPassword;
        user.mustChangePassword = false;
        await user.save();

        // Revoke all existing sessions across devices for security
        try {
            await SessionService.revokeAllUserSessions(String(user._id));
        } catch (sessionErr) {
            console.warn('[AuthService] Session revocation failed during password reset:', sessionErr);
        }

        // Send confirmation email
        await this.sendPasswordChangedNotificationEmail(user.email, user.name);

        // Audit log
        await AuditLogService.log({
            action: AuditAction.PASSWORD_CHANGED,
            actorId: String(user._id),
            actorEmail: user.email,
            targetUserId: String(user._id),
            targetEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `Password reset successfully via 6-digit email OTP for: ${user.email}`,
            req,
        });

        return {
            message: 'Password reset successfully. You can now log in with your new password.',
        };
    }
}
