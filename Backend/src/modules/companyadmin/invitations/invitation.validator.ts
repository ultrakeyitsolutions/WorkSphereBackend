import { z } from 'zod';

const memberSchema = z.object({
    emailOrPhone: z.string().trim().min(1, 'emailOrPhone is required'),
    roleId: z.string().trim().min(1, 'roleId is required'),
    designationId: z.string().trim().min(1, 'designationId is required'),
    memberType: z.enum(['EMPLOYEE', 'CLIENT', 'MANAGER']),
});

export const inviteMembersSchema = z.object({
    members: z.array(memberSchema).min(1, 'At least one member is required').max(50, 'Maximum 50 members per request'),
});

export const acceptInvitationSchema = z.object({
    token: z.string().trim().min(1, 'Token is required'),
    password: z.string().min(1, 'Password is required'),
});

export const registerViaInvitationSchema = z.object({
    token: z.string().trim().min(1, 'Token is required'),
    name: z.string().trim().min(1, 'Name is required').max(200),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const validateTokenQuerySchema = z.object({
    token: z.string().trim().min(1, 'Token query parameter is required'),
});
