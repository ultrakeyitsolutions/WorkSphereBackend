import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MfaService } from '../src/modules/auth/mfa/mfa.service';
import { UserMfa } from '../src/modules/auth/mfa/mfa-record.model';
import { User } from '../src/modules/users/user.model';
import argon2 from 'argon2';
import speakeasy from 'speakeasy';

// Mock mail transporter
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test_msg_id' });
vi.mock('../src/config/mail', () => ({
    getMailTransporter: () => ({
        sendMail: mockSendMail,
    }),
    mailDefaults: {
        from: 'test@worksphere.com',
    },
}));

// Mock AuditLog
vi.mock('../src/modules/audit-logs/audit-log.service', () => ({
    AuditLogService: {
        log: vi.fn().mockResolvedValue(true),
    },
    AuditAction: {
        MFA_SETUP_INITIATED: 'MFA_SETUP_INITIATED',
        MFA_ENABLED: 'MFA_ENABLED',
        MFA_DISABLED: 'MFA_DISABLED',
        MFA_VERIFY_SUCCESS: 'MFA_VERIFY_SUCCESS',
        MFA_VERIFY_FAILED: 'MFA_VERIFY_FAILED',
        MFA_RECOVERY_USED: 'MFA_RECOVERY_USED',
        MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',
    },
}));

describe('MFA Service - Two-Step Key Request & Email Delivery', () => {
    const mockUserId = '654321654321654321654321';
    const mockEmail = 'user@worksphere.io';

    let mockRecord: any;
    let mockUser: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockUser = {
            _id: mockUserId,
            email: mockEmail,
            name: 'Test User',
            isActive: true,
            mfaEnabled: false,
            save: vi.fn().mockResolvedValue(true),
        };

        mockRecord = {
            userId: mockUserId,
            method: 'totp',
            secretEncrypted: null as string | null,
            enabledAt: null,
            setupExpiresAt: null,
            keyOtpHash: null as string | null,
            keyOtpExpiresAt: null as Date | null,
            keyOtpAttempts: 0,
            lastUsedCode: null,
            lastUsedCodeAt: null,
            recoveryCodeHashes: [] as string[],
            save: vi.fn().mockResolvedValue(true),
        };

        vi.spyOn(User, 'findById').mockResolvedValue(mockUser as any);
        vi.spyOn(UserMfa, 'findOne').mockImplementation(() => Promise.resolve(mockRecord) as any);
        vi.spyOn(UserMfa, 'findOneAndUpdate').mockImplementation((_query, update: any) => {
            Object.assign(mockRecord, update);
            return Promise.resolve(mockRecord) as any;
        });
    });

    it('Step 1 (Setup): Should generate QR code and NOT return secret key directly', async () => {
        const result = await MfaService.generateSetup(mockUserId, mockEmail);

        expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
        expect(result.otpauthUrl).toContain('otpauth://totp/WorkSphere');
        expect(result.sentToEmail).toBe(mockEmail);
        // Secret must not be returned in API response
        expect((result as any).secret).toBeUndefined();
        expect(mockRecord.secretEncrypted).toBeDefined();
        expect(mockRecord.setupExpiresAt).toBeDefined();
    });

    it('Step 2A (Request Key): Should generate a 6-character code with letters, numbers, and special chars and send to email', async () => {
        await MfaService.generateSetup(mockUserId, mockEmail);
        const result = await MfaService.requestKeyOtp(mockUserId);

        expect(result.sentToEmail).toBe(mockEmail);
        expect(result.message).toContain('verification code with letters, numbers, and special characters');
        expect(mockRecord.keyOtpHash).toBeDefined();
        expect(mockRecord.keyOtpExpiresAt).toBeDefined();
        expect(mockSendMail).toHaveBeenCalledTimes(1);

        // Inspect email payload sent to user
        const mailCall = mockSendMail.mock.calls[0][0];
        expect(mailCall.to).toBe(mockEmail);
        expect(mailCall.subject).toContain('Verification Code for MFA Key Request');
        // Extract 6-character code from HTML
        const match = mailCall.html.match(/class="otp-code">([^<]+)<\/div>/);
        expect(match).not.toBeNull();
        const extractedCode = match[1];

        expect(extractedCode.length).toBe(6);
        // Must contain special character (@, #, $, %, &, *, or !)
        expect(/[@#$%&*!]/.test(extractedCode)).toBe(true);
        // Must contain digit
        expect(/\d/.test(extractedCode)).toBe(true);
        // Must contain letter
        expect(/[a-zA-Z]/.test(extractedCode)).toBe(true);

        // Hash in DB must verify with extracted code
        const isMatch = await argon2.verify(mockRecord.keyOtpHash, extractedCode);
        expect(isMatch).toBe(true);
    });

    it('Step 2B (Verify Key OTP): Entering valid 6-character code should email the manual setup key and clear the OTP', async () => {
        await MfaService.generateSetup(mockUserId, mockEmail);

        // Generate OTP
        await MfaService.requestKeyOtp(mockUserId);
        const mailCall1 = mockSendMail.mock.calls[0][0];
        const extractedCode = mailCall1.html.match(/class="otp-code">([^<]+)<\/div>/)[1];

        mockSendMail.mockClear();

        // Submit the extracted code
        const verifyResult = await MfaService.verifyKeyOtpAndSendKey(mockUserId, extractedCode);

        expect(verifyResult.sentToEmail).toBe(mockEmail);
        expect(verifyResult.message).toContain('Your manual MFA setup key has been sent');

        // OTP must be cleared from DB (cannot be reused)
        expect(mockRecord.keyOtpHash).toBeNull();
        expect(mockRecord.keyOtpExpiresAt).toBeNull();
        expect(mockRecord.keyOtpAttempts).toBe(0);

        // Setup key email delivered
        expect(mockSendMail).toHaveBeenCalledTimes(1);
        const mailCall2 = mockSendMail.mock.calls[0][0];
        expect(mailCall2.to).toBe(mockEmail);
        expect(mailCall2.html).toContain('Manual Setup Key');
        expect(mailCall2.html).toContain('Microsoft Authenticator');
    });

    it('Security: Entering an incorrect 6-character code should fail and reject', async () => {
        await MfaService.generateSetup(mockUserId, mockEmail);
        await MfaService.requestKeyOtp(mockUserId);

        await expect(
            MfaService.verifyKeyOtpAndSendKey(mockUserId, 'WRONG!')
        ).rejects.toThrow(/Invalid confirmation code/);

        expect(mockRecord.keyOtpAttempts).toBe(1);
    });

    it('Security: OTP cannot be reused once verified', async () => {
        await MfaService.generateSetup(mockUserId, mockEmail);
        await MfaService.requestKeyOtp(mockUserId);
        const extractedCode = mockSendMail.mock.calls[0][0].html.match(/class="otp-code">([^<]+)<\/div>/)[1];

        // First verification succeeds
        await MfaService.verifyKeyOtpAndSendKey(mockUserId, extractedCode);

        // Reusing the same code must immediately fail
        await expect(
            MfaService.verifyKeyOtpAndSendKey(mockUserId, extractedCode)
        ).rejects.toThrow(/No active verification code found/);
    });
});
