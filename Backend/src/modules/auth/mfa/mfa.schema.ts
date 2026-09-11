import { z } from 'zod';

export const mfaSetupVerifySchema = z.object({
    code: z
        .string()
        .trim()
        .length(6, { message: 'MFA code must be exactly 6 digits' })
        .regex(/^\d{6}$/, { message: 'MFA code must contain only numbers' }),
});

export const mfaVerifySchema = z.object({
    challengeId: z.string().trim().min(1, { message: 'Challenge ID is required' }),
    code: z
        .string()
        .trim()
        .length(6, { message: 'MFA code must be exactly 6 digits' })
        .regex(/^\d{6}$/, { message: 'MFA code must contain only numbers' }),
});

export const mfaRecoverySchema = z.object({
    challengeId: z.string().trim().min(1, { message: 'Challenge ID is required' }),
    recoveryCode: z.string().trim().min(1, { message: 'Recovery code is required' }),
});

export const mfaDisableSchema = z.object({
    code: z
        .string()
        .trim()
        .length(6, { message: 'MFA code must be exactly 6 digits' })
        .regex(/^\d{6}$/, { message: 'MFA code must contain only numbers' }),
});

export const mfaKeyOtpVerifySchema = z.object({
    otp: z
        .string()
        .trim()
        .min(4, { message: 'Verification code must be at least 4 characters' })
        .max(12, { message: 'Verification code too long' }),
});
