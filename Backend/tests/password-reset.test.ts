import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PasswordReset } from '../src/modules/auth/password-reset.model';
import { UserService } from '../src/modules/users/user.service';
import { SessionService } from '../src/modules/auth/session/session.service';
import argon2 from 'argon2';
import { resetPasswordSchema } from '../src/modules/auth/auth.schema';

// Mock mailer
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
        PASSWORD_CHANGED: 'PASSWORD_CHANGED',
        USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
    },
}));

// Mock SessionService
vi.mock('../src/modules/auth/session/session.service', () => ({
    SessionService: {
        revokeAllUserSessions: vi.fn().mockResolvedValue(2),
    },
}));

describe('Forgot Password & Reset Password Service', () => {
    const mockEmail = 'employee@worksphere.com';
    let mockUser: any;
    let mockResetRecord: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockUser = {
            _id: '654321654321654321654321',
            name: 'Employee One',
            email: mockEmail,
            password: 'old_hashed_password',
            isActive: true,
            mustChangePassword: true,
            save: vi.fn().mockResolvedValue(true),
        };

        mockResetRecord = null;

        vi.spyOn(UserService, 'findByEmail').mockImplementation(async (email: string) => {
            if (email.toLowerCase() === mockEmail.toLowerCase()) {
                return mockUser;
            }
            return null;
        });

        vi.spyOn(PasswordReset, 'deleteMany').mockResolvedValue({} as any);
        vi.spyOn(PasswordReset, 'create').mockImplementation(async (data: any) => {
            mockResetRecord = {
                ...data,
                _id: 'reset_id_123',
                save: vi.fn().mockResolvedValue(true),
            };
            return mockResetRecord;
        });

        vi.spyOn(PasswordReset, 'findOne').mockImplementation((_query: any) => ({
            sort: () => Promise.resolve(mockResetRecord),
        }) as any);

        vi.spyOn(PasswordReset, 'deleteOne').mockResolvedValue({} as any);
    });

    it('Step 1 (Forgot Password): Generates 6-digit numeric OTP and emails it', async () => {
        const result = await AuthService.requestPasswordReset(mockEmail);

        expect(result.message).toContain('If an account exists with this email, a 6-digit password reset code has been sent.');
        expect(PasswordReset.create).toHaveBeenCalledTimes(1);
        expect(mockSendMail).toHaveBeenCalledTimes(1);

        const mailCall = mockSendMail.mock.calls[0][0];
        expect(mailCall.to).toBe(mockEmail);
        expect(mailCall.subject).toContain('Password Reset Verification Code');

        // Extract 6-digit code from email html
        const match = mailCall.html.match(/class="otp-code">(\d{6})<\/div>/);
        expect(match).not.toBeNull();
        const extractedOtp = match[1];
        expect(extractedOtp.length).toBe(6);

        // Verify the stored hash matches the OTP sent
        const isValid = await argon2.verify(mockResetRecord.otpHash, extractedOtp);
        expect(isValid).toBe(true);
    });

    it('Security: Non-existent email returns generic message and does not send email', async () => {
        const result = await AuthService.requestPasswordReset('nonexistent@example.com');

        expect(result.message).toContain('If an account exists with this email, a 6-digit password reset code has been sent.');
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('Step 2 (Reset Password): Resets password with valid code and strong password, revokes sessions, and burns OTP', async () => {
        // First request password reset
        await AuthService.requestPasswordReset(mockEmail);
        const mailCall = mockSendMail.mock.calls[0][0];
        const extractedOtp = mailCall.html.match(/class="otp-code">(\d{6})<\/div>/)[1];

        mockSendMail.mockClear();

        const newPassword = 'NewSecretPassword1@';
        const result = await AuthService.resetPassword({
            email: mockEmail,
            code: extractedOtp,
            newPassword,
        });

        expect(result.message).toContain('Password reset successfully');
        expect(mockUser.save).toHaveBeenCalled();
        expect(mockUser.mustChangePassword).toBe(false);

        // Verified that new password was hashed and is different from old
        expect(mockUser.password).not.toBe('old_hashed_password');
        const isPasswordCorrect = await argon2.verify(mockUser.password, newPassword);
        expect(isPasswordCorrect).toBe(true);

        // Stored reset record marked as used (cannot be reused)
        expect(mockResetRecord.usedAt).toBeDefined();

        // Sessions revoked across all devices
        expect(SessionService.revokeAllUserSessions).toHaveBeenCalledWith(mockUser._id);

        // Confirmation email sent
        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(mockSendMail.mock.calls[0][0].subject).toContain('Your Password Has Been Changed');
    }, 15000);

    it('Security: Entering invalid 6-digit code should fail and increment attempts', async () => {
        await AuthService.requestPasswordReset(mockEmail);

        await expect(
            AuthService.resetPassword({
                email: mockEmail,
                code: '000000',
                newPassword: 'NewSecretPassword1@',
            })
        ).rejects.toThrow(/Invalid 6-digit reset code/);

        expect(mockResetRecord.attempts).toBe(1);
    });

    it('Validation: Weak passwords should fail resetPasswordSchema validation', () => {
        // Less than 8 characters
        const res1 = resetPasswordSchema.safeParse({
            email: mockEmail,
            code: '123456',
            newPassword: 'Pass1!',
        });
        expect(res1.success).toBe(false);

        // Missing uppercase letter
        const res2 = resetPasswordSchema.safeParse({
            email: mockEmail,
            code: '123456',
            newPassword: 'password123!',
        });
        expect(res2.success).toBe(false);

        // Missing number
        const res3 = resetPasswordSchema.safeParse({
            email: mockEmail,
            code: '123456',
            newPassword: 'Password!@#',
        });
        expect(res3.success).toBe(false);

        // Missing special character
        const res4 = resetPasswordSchema.safeParse({
            email: mockEmail,
            code: '123456',
            newPassword: 'Password123',
        });
        expect(res4.success).toBe(false);

        // Valid password meets all criteria
        const res5 = resetPasswordSchema.safeParse({
            email: mockEmail,
            code: '123456',
            newPassword: 'ValidPassword123!',
        });
        expect(res5.success).toBe(true);
    });
});
