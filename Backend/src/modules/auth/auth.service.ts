import { performance } from 'perf_hooks';
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
import { env } from '../../config/env';
import { maskEmail } from '../../utils/mask.util';
import { ImpersonationSession } from '../super-admin/impersonation/impersonation.model';
import { ImpersonationStatus } from '../super-admin/impersonation/impersonation.types';
import { User } from '../users/user.model';
import { AppError } from '../../utils/AppError';
import CompanyMember from '../companyadmin/invitations/company-member.model';
import { getRedisClient } from '../../config/redis';
import { getSocketServer } from '../../sockets/socket-server';

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
        const totalStart = performance.now();

        const findByEmailStart = performance.now();
        const user = await UserService.findByEmail(data.email);
        console.log(
            `[LOGIN] findByEmail: ${(performance.now() - findByEmailStart).toFixed(2)}ms`
        );

        if (!user) {
            // Log failed login attempt
            const auditStart = performance.now();
            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorEmail: data.email,
                success: false,
                description: `Failed login attempt for email: ${data.email} — user not found`,
                req,
            });
            console.log(
                `[LOGIN] auditLog (user not found): ${(performance.now() - auditStart).toFixed(2)}ms`
            );
            console.log(
                `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
            );
            throw new Error('Invalid email or password');
        }

        if (user.isDeleted || user.deletedAt || !user.isActive || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED' || (user as any).accountStatus === 'SUSPENDED') {
            const auditStart = performance.now();
            const isSuspended = user.status === 'SUSPENDED' || (user as any).accountStatus === 'SUSPENDED';
            const roleName = (user.role as any)?.name ?? '';
            const isCompanyAdmin = roleName === 'COMPANY_ADMIN' || roleName === 'Admin';

            await AuditLogService.log({
                action: AuditAction.USER_LOGIN_FAILED,
                actorId: String(user._id),
                actorEmail: user.email,
                actorRole: roleName || null,
                companyId: user.companyId ? String(user.companyId) : null,
                success: false,
                description: isSuspended
                    ? `Failed login — account suspended for: ${user.email}`
                    : user.isDeleted
                        ? `Failed login — account deleted for: ${user.email}`
                        : `Failed login — account deactivated for: ${user.email}`,
                req,
            });
            console.log(
                `[LOGIN] auditLog (deactivated/suspended/deleted): ${(performance.now() - auditStart).toFixed(2)}ms`
            );
            console.log(
                `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
            );

            if (isSuspended) {
                const suspensionMsg = isCompanyAdmin
                    ? 'Your account has been suspended. Please contact the platform administrator.'
                    : 'Your account has been suspended. Please contact your company administrator.';
                throw new AppError(suspensionMsg, 403, { code: 'ACCOUNT_SUSPENDED' });
            }

            // Determine if account is eligible for recovery
            const now = new Date();
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            const eligibleUntil =
                user.recoveryEligibleUntil ||
                (user.deletedAt ? new Date(user.deletedAt.getTime() + thirtyDaysMs) : null);
            const isEligible = !eligibleUntil || eligibleUntil > now;

            throw new AppError('Your account is deactivated', 400, {
                action: isEligible ? 'ACCOUNT_RECOVERY_AVAILABLE' : 'ACCOUNT_DELETED_INELIGIBLE',
                recoveryAction: isEligible ? 'ACCOUNT_RECOVERY_AVAILABLE' : undefined,
                recoveryEligible: isEligible,
            });
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const companyStart = performance.now();
            const company = await Company.findById(user.companyId);
            console.log(
                `[LOGIN] findCompany: ${(performance.now() - companyStart).toFixed(2)}ms`
            );

            if (!company) {
                await AuditLogService.log({
                    action: AuditAction.USER_LOGIN_FAILED,
                    actorId: String(user._id),
                    actorEmail: user.email,
                    success: false,
                    description: `Failed login — organization not found for: ${user.email}`,
                    req,
                });
                console.log(
                    `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
                );
                throw new AppError('Your organization account is not found.', 401);
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
                console.log(
                    `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
                );
                throw new AppError('Your organization account is currently suspended.', 403);
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
                console.log(
                    `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
                );
                throw new AppError('Your organization account is no longer active.', 403);
            }
            companyDoc = company;

            // ─── Company Member Status Check for non-admin members ─────────────────
            const roleName = (user.role as any)?.name ?? '';
            if (roleName !== 'SUPER_ADMIN' && roleName !== 'COMPANY_ADMIN' && roleName !== 'Admin') {
                const member = await CompanyMember.findOne({ userId: user._id, companyId: user.companyId });
                if (member && (member.status === 'SUSPENDED' || member.status === 'INACTIVE')) {
                    await AuditLogService.log({
                        action: AuditAction.USER_LOGIN_FAILED,
                        actorId: String(user._id),
                        actorEmail: user.email,
                        companyId: String(user.companyId),
                        success: false,
                        description: `Failed login — employee ${member.status.toLowerCase()} for: ${user.email}`,
                        req,
                    });
                    const msg = member.status === 'SUSPENDED'
                        ? 'Your account has been suspended. Please contact your company administrator.'
                        : 'Your account is currently inactive. Please contact your company administrator.';
                    throw new AppError(msg, 403, { code: 'ACCOUNT_SUSPENDED' });
                }
            }
        }

        const pwdStart = performance.now();
        const isMatch = await comparePassword(data.password, user.password || '');
        console.log(
            `[LOGIN] password verification: ${(performance.now() - pwdStart).toFixed(2)}ms`
        );

        if (!isMatch) {
            const auditStart = performance.now();
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
            console.log(
                `[LOGIN] auditLog (wrong password): ${(performance.now() - auditStart).toFixed(2)}ms`
            );
            console.log(
                `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
            );
            throw new Error('Invalid email or password');
        }

        // ─── MFA Gate ────────────────────────────────────────────────────────────
        if (user.mfaEnabled) {
            const mfaStart = performance.now();
            const challengeId = await MfaService.createChallenge(user._id, 'LOGIN');
            console.log(
                `[LOGIN] mfaChallenge: ${(performance.now() - mfaStart).toFixed(2)}ms`
            );
            console.log(
                `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
            );
            return {
                status: 'MFA_REQUIRED',
                challengeId,
            };
        }

        const authResponse = await this.generateAuthSessionResponse(user, req, null, companyDoc);
        console.log(
            `[LOGIN] TOTAL: ${(performance.now() - totalStart).toFixed(2)}ms`
        );
        return authResponse;
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
            const compStart = performance.now();
            companyDoc = await Company.findById(user.companyId);
            console.log(
                `[LOGIN] findCompany: ${(performance.now() - compStart).toFixed(2)}ms`
            );
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

        const tokenStart = performance.now();
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);
        console.log(
            `[LOGIN] token generation: ${(performance.now() - tokenStart).toFixed(2)}ms`
        );

        // ─── Create Auth Session ─────────────────────────────────────────────
        const sessionStart = performance.now();
        await SessionService.createSession({
            userId: user._id,
            refreshToken,
            mfaVerifiedAt: mfaVerifiedAt || (user.mfaEnabled ? new Date() : null),
            req,
        });
        console.log(
            `[LOGIN] createSession: ${(performance.now() - sessionStart).toFixed(2)}ms`
        );

        // ─── Successful login audit ──────────────────────────────────────────
        const auditStart = performance.now();
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
        console.log(
            `[LOGIN] auditLog: ${(performance.now() - auditStart).toFixed(2)}ms`
        );

        const subStart = performance.now();
        const subscriptionData = companyDoc
            ? await CompanyProfileService.getCompanySubscription(String(companyDoc._id))
            : null;
        console.log(
            `[LOGIN] subscription: ${(performance.now() - subStart).toFixed(2)}ms`
        );

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

        // ─── If refreshing an Impersonated Token, validate Impersonation Session ──
        if (decoded.isImpersonating || decoded.sessionType === 'IMPERSONATION' || decoded.impersonationSessionId) {
            let impSession: any = null;
            if (decoded.impersonationSessionId) {
                impSession = await ImpersonationSession.findOne({ sessionId: decoded.impersonationSessionId });
            } else {
                const authUserId = decoded.authUserId || decoded.sessionUserId;
                impSession = await ImpersonationSession.findOne({
                    originalUserId: authUserId,
                    targetUserId: decoded.userId,
                }).sort({ startedAt: -1 });
            }

            if (!impSession || impSession.status !== ImpersonationStatus.ACTIVE) {
                throw new Error('Impersonation session is no longer active.');
            }

            if (impSession.expiresAt && impSession.expiresAt.getTime() <= Date.now()) {
                impSession.status = ImpersonationStatus.EXPIRED;
                impSession.endedAt = new Date();
                await impSession.save();
                throw new Error('Impersonation session has expired.');
            }
        }


        const user = await UserService.findById(decoded.userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (!user.isActive || user.isDeleted || (user as any).status === 'DEACTIVATED' || (user as any).status === 'SUSPENDED' || (user as any).accountStatus === 'SUSPENDED') {
            const msg = (user as any).status === 'SUSPENDED' || (user as any).accountStatus === 'SUSPENDED'
                ? 'User account is suspended'
                : 'User account is deactivated';
            throw new AppError(msg, 403);
        }

        // ─── Company Member Status Check for non-admin users ─────────────────────
        const roleName = (user.role as any)?.name ?? '';
        if (user.companyId && roleName !== 'SUPER_ADMIN' && roleName !== 'COMPANY_ADMIN' && roleName !== 'Admin') {
            const member = await CompanyMember.findOne({ userId: user._id, companyId: user.companyId });
            if (member && (member.status === 'SUSPENDED' || member.status === 'INACTIVE')) {
                throw new AppError('User account is suspended', 403);
            }
        }

        // ─── Company Status Check ────────────────────────────────────────────────
        let companyDoc: any = null;
        if (user.companyId) {
            const company = await Company.findById(user.companyId);
            if (!company) {
                throw new AppError('Your organization account is not found.', 401);
            }
            if (company.status === 'SUSPENDED') {
                throw new AppError('Your organization account is currently suspended.', 403);
            }
            if (company.status === 'DELETED' || !company.isActive) {
                throw new AppError('Your organization account is no longer active.', 403);
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

        const payload: any = {
            userId: String(user._id),
            email: user.email,
            role: userRole,
            companyId: user.companyId ? String(user.companyId) : undefined,
        };

        if (decoded.isImpersonating || decoded.sessionType === 'IMPERSONATION' || decoded.impersonationSessionId) {
            payload.sub = String(user._id);
            payload.authUserId = decoded.authUserId || decoded.sessionUserId;
            payload.effectiveUserId = String(user._id);
            payload.sessionUserId = decoded.sessionUserId || decoded.authUserId;
            payload.isImpersonating = true;
            payload.impersonationSessionId = decoded.impersonationSessionId;
            payload.sessionType = 'IMPERSONATION';
            payload.impersonatedBy = decoded.impersonatedBy || decoded.authUserId;
        }

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
        const maskedRecipient = maskEmail(toEmail);
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

            console.log(`[AuthService] Attempting to dispatch password reset email: recipient=${maskedRecipient}, driver=${env.MAIL_DRIVER}, host=${env.MAIL_HOST}:${env.MAIL_PORT}, encryption=${env.MAIL_ENCRYPTION}`);

            const info = await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            console.log(`[AuthService] Password reset email successfully delivered to SMTP server: recipient=${maskedRecipient}, messageId=${info.messageId || 'N/A'}, response=${info.response || 'OK'}`);
            return true;
        } catch (error: any) {
            console.error('[AuthService] Failed to send password reset email:', {
                recipient: maskedRecipient,
                driver: env.MAIL_DRIVER,
                host: env.MAIL_HOST,
                port: env.MAIL_PORT,
                encryption: env.MAIL_ENCRYPTION,
                from: env.MAIL_FROM_ADDRESS,
                errorCode: error.code || error.name || 'UNKNOWN',
                command: error.command || null,
                responseCode: error.responseCode || null,
                errorMessage: error.message || 'Unknown SMTP error',
                smtpResponse: error.response || null,
            });
            return false;
        }
    }

    /**
     * Send email notification confirming that the password has been changed
     */
    private static async sendPasswordChangedNotificationEmail(toEmail: string, userName?: string): Promise<boolean> {
        const maskedRecipient = maskEmail(toEmail);
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

            console.log(`[AuthService] Attempting to dispatch password changed notification email: recipient=${maskedRecipient}`);

            const info = await transporter.sendMail({
                from: mailDefaults.from,
                to: toEmail,
                subject,
                html,
            });

            console.log(`[AuthService] Password changed notification email delivered successfully: recipient=${maskedRecipient}, messageId=${info.messageId || 'N/A'}`);
            return true;
        } catch (error: any) {
            console.error('[AuthService] Failed to send password changed email:', {
                recipient: maskedRecipient,
                errorCode: error.code || error.name || 'UNKNOWN',
                command: error.command || null,
                responseCode: error.responseCode || null,
                errorMessage: error.message || 'Unknown error',
            });
            return false;
        }
    }

    /**
     * Request password reset: generates 6-digit numeric OTP, hashes with Argon2, and sends email
     */
    static async requestPasswordReset(email: string, _req?: Request) {
        const normalizedEmail = email.trim().toLowerCase();
        const masked = maskEmail(normalizedEmail);
        const user = await UserService.findByEmail(normalizedEmail);

        // Security best practice: Always return generic success message to prevent user enumeration
        if (!user || !user.isActive) {
            console.warn(`[AuthService] Password reset requested for non-existent or inactive user: ${masked} (userFound=${!!user}, isActive=${user?.isActive ?? false})`);
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
        const emailSent = await this.sendPasswordResetOtpEmail(user.email, otp, user.name);
        if (!emailSent) {
            console.error(`[AuthService] Password reset OTP saved to database for ${masked}, but email dispatch FAILED.`);
        } else {
            console.log(`[AuthService] Password reset OTP successfully generated and email dispatched to ${masked}.`);
        }

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

    /**
     * Authenticated user soft-deletes/suspends their own account
     */
    static async deleteAccount(userId: string, reason?: string, req?: Request) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.isDeleted || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED' || !user.isActive) {
            throw new Error('Account is already deleted, suspended, or deactivated');
        }

        let roleName = '';
        if (user.role && typeof user.role === 'object' && (user.role as any).name) {
            roleName = (user.role as any).name;
        } else if (user.role) {
            const roleDoc = await Role.findById(user.role).select('name');
            roleName = roleDoc?.name ?? '';
        }

        if (roleName === 'SUPER_ADMIN') {
            throw new Error('Super Admin account deletion is not permitted via this endpoint');
        }

        const isCompanyAdmin = roleName === 'COMPANY_ADMIN' || roleName === 'Admin';
        const isMember = Boolean(user.companyId && !isCompanyAdmin);

        const now = new Date();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const defaultReason = reason || (isCompanyAdmin ? 'Company Admin requested account deletion' : 'Employee requested account deletion');

        if (isCompanyAdmin) {
            // Requirement 2: Company Admin Account Deletion
            // - Do not permanently delete the company admin or company record.
            // - Suspend/deactivate the Company Admin account and immediately block login.
            // - Show the suspended Company Admin and the correct status in the Super Admin panel.
            // - Only the Super Admin can reactivate the suspended Company Admin account.
            user.isDeleted = false;
            user.deletedAt = now;
            user.deletedBy = user._id;
            user.isActive = false;
            user.status = 'SUSPENDED';
            user.accountStatus = 'SUSPENDED';
            user.recoveryEligibleUntil = new Date(now.getTime() + thirtyDaysMs);
            user.deletionReason = defaultReason;
            await user.save();

            // When a Company Admin is suspended, all users belonging to that company
            // must be prevented from logging in or accessing protected APIs according
            // to the existing company suspension rules.
            if (user.companyId) {
                const company = await Company.findById(user.companyId);
                if (company && company.status !== 'DELETED') {
                    company.status = 'SUSPENDED';
                    company.isActive = false;
                    company.suspendedAt = now;
                    company.suspendedBy = user._id as any;
                    company.suspensionReason = defaultReason;
                    await company.save();

                    // Revoke sessions for all users in this company
                    const companyUsers = await User.find({ companyId: user.companyId }).select('_id');
                    for (const u of companyUsers) {
                        await SessionService.revokeAllUserSessions(String(u._id)).catch(() => {});
                        try {
                            const redis = getRedisClient();
                            if (redis) {
                                await redis.del(`session:${u._id}`, `user:${u._id}`).catch(() => {});
                            }
                        } catch {}
                    }

                    // Disconnect all socket connections in the company
                    try {
                        const io = getSocketServer();
                        if (io) {
                            io.in(`company:${user.companyId}`).disconnectSockets(true);
                        }
                    } catch {}
                }
            }
        } else if (isMember) {
            // Requirement 1: Employee Account Deletion
            // - Do not permanently delete the employee record from the database.
            // - Change the employee's account status to Suspended/Inactive and immediately block login.
            // - The suspended employee must be visible in the Company Admin panel with the correct status.
            // - The Company Admin should be able to view the employee's suspended status.
            user.isDeleted = false;
            user.deletedAt = now;
            user.deletedBy = user._id;
            user.isActive = false;
            user.status = 'SUSPENDED';
            user.accountStatus = 'SUSPENDED';
            user.recoveryEligibleUntil = new Date(now.getTime() + thirtyDaysMs);
            user.deletionReason = defaultReason;
            await user.save();

            if (user.companyId) {
                const member = await CompanyMember.findOne({ userId: user._id, companyId: user.companyId });
                if (member) {
                    member.status = 'SUSPENDED';
                    await member.save();
                }

                try {
                    const redis = getRedisClient();
                    if (redis) {
                        const uId = String(user._id);
                        const cId = String(user.companyId);
                        await redis.del(
                            `session:${uId}`,
                            `user:${uId}`,
                            `worksphere:cache:member:${cId}:${uId}`,
                            `worksphere:cache:module_access:${cId}:${uId}`
                        ).catch(() => {});
                    }
                } catch {}

                try {
                    const io = getSocketServer();
                    if (io) {
                        const uId = String(user._id);
                        const cId = String(user.companyId);
                        io.to(`user:${uId}`).emit('member:status_updated', {
                            companyId: cId,
                            memberId: member?._id ? String(member._id) : undefined,
                            userId: uId,
                            status: 'SUSPENDED',
                            isActive: false,
                            timestamp: Date.now(),
                        });
                        io.to(`company:${cId}`).emit('company:member_status_updated', {
                            companyId: cId,
                            memberId: member?._id ? String(member._id) : undefined,
                            userId: uId,
                            status: 'SUSPENDED',
                            timestamp: Date.now(),
                        });
                        io.in(`user:${uId}`).disconnectSockets(true);
                    }
                } catch {}
            }
        } else {
            // Standalone user without company
            user.isDeleted = true;
            user.deletedAt = now;
            user.deletedBy = user._id;
            user.isActive = false;
            user.status = 'DEACTIVATED';
            user.accountStatus = 'DELETED';
            user.recoveryEligibleUntil = new Date(now.getTime() + thirtyDaysMs);
            user.deletionReason = reason || 'User requested account deletion';
            await user.save();
        }

        // Invalidate all active user sessions
        try {
            await SessionService.revokeAllUserSessions(String(user._id));
        } catch (sessionErr) {
            console.warn('[AuthService] Session revocation failed during account deletion:', sessionErr);
        }

        // Disconnect user socket directly
        try {
            const io = getSocketServer();
            if (io) {
                io.in(`user:${user._id}`).disconnectSockets(true);
            }
        } catch {}

        // Audit log
        await AuditLogService.log({
            action: isCompanyAdmin ? AuditAction.COMPANY_SUSPENDED : AuditAction.USER_ACCOUNT_DELETED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: isCompanyAdmin
                ? `Company Admin requested account deletion & company suspension for: ${user.email}`
                : `User requested account deletion/suspension for: ${user.email}`,
            metadata: {
                deletedAt: now,
                recoveryEligibleUntil: user.recoveryEligibleUntil,
                reason: user.deletionReason,
                accountStatus: user.accountStatus,
            },
            req,
        });

        return {
            success: true,
            message: isCompanyAdmin
                ? 'Your company admin account and organization have been suspended. Please contact the platform super administrator to reactivate your account.'
                : 'Your account has been suspended. Please contact your company administrator to reactivate your account.',
            status: user.status,
            recoveryEligibleUntil: user.recoveryEligibleUntil,
        };
    }
}

