import { z } from 'zod';

export const createRoleSchema = z.object({
    name: z.string().trim().min(1, 'Role name is required').max(100),
    description: z.string().trim().max(500).optional(),
});

export const updateRoleSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
}).refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
});

export const setRoleStatusSchema = z.object({
    isActive: z.boolean({ message: 'isActive is required' }),
});
