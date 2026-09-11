import { z } from 'zod';

export const registerSchema = z.object({
    name: z.string().min(2, { message: 'Name must be at least 2 characters long' }),
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long' }),
    roleName: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(1, { message: 'Password is required' }),
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(1, { message: 'Refresh token is required' }),
});

export const forgotPasswordSchema = z.object({
    email: z.string().trim().email({ message: 'Invalid email address' }),
});

export const resetPasswordSchema = z.object({
    email: z.string().trim().email({ message: 'Invalid email address' }),
    code: z
        .string()
        .trim()
        .length(6, { message: 'Verification code must be exactly 6 digits' })
        .regex(/^\d{6}$/, { message: 'Verification code must contain only numbers' }),
    newPassword: z
        .string()
        .min(8, { message: 'Password must be at least 8 characters long' })
        .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
        .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
        .regex(/[0-9]/, { message: 'Password must contain at least one number' })
        .regex(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
});

