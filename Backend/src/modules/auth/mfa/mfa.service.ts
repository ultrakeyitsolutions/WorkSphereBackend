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
     * Step 1: Initiate MFA setup
     * Generates a secure TOTP secret, encrypts it, generates an otpauth:// URI and QR code.
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

        await AuditLogService.log({
            action: AuditAction.MFA_SETUP_INITIATED,
            actorId: String(user._id),
            actorEmail: user.email,
            companyId: user.companyId ? String(user.companyId) : null,
            success: true,
            description: `MFA setup initiated for user: ${user.email}`,
            req,
        });

        return {
            qrCodeDataUrl,
            otpauthUrl,
            secret, // Provided for manual entry in Microsoft Authenticator app
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
