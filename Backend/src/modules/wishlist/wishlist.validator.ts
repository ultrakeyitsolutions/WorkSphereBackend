import { z } from 'zod';
import { WishlistPriority, WishlistStatus } from './wishlist.types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const idSchema = z.string().regex(objectIdRegex, 'Invalid MongoDB ObjectId');

export const wishlistParamSchema = z.object({
    params: z.object({
        projectId: idSchema,
        wishlistId: idSchema.optional(),
    }),
});

export const createWishlistSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    body: z.object({
        title: z.string().trim().min(2, 'Title must be at least 2 characters').max(300, 'Title cannot exceed 300 characters'),
        description: z.string().trim().max(5000, 'Description cannot exceed 5000 characters').optional().nullable(),
        priority: z.nativeEnum(WishlistPriority).default(WishlistPriority.MEDIUM),
        tags: z.array(z.string().trim()).optional(),
        status: z.nativeEnum(WishlistStatus).optional().default(WishlistStatus.IDEA),
    }),
});

export const updateWishlistSchema = z.object({
    params: z.object({
        projectId: idSchema,
        wishlistId: idSchema,
    }),
    body: z.object({
        title: z.string().trim().min(2, 'Title must be at least 2 characters').max(300, 'Title cannot exceed 300 characters').optional(),
        description: z.string().trim().max(5000, 'Description cannot exceed 5000 characters').optional().nullable(),
        status: z.nativeEnum(WishlistStatus).optional(),
        priority: z.nativeEnum(WishlistPriority).optional(),
        tags: z.array(z.string().trim()).optional(),
    }),
});

export const listWishlistSchema = z.object({
    params: z.object({
        projectId: idSchema,
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
        status: z.nativeEnum(WishlistStatus).optional(),
        priority: z.nativeEnum(WishlistPriority).optional(),
        createdBy: idSchema.optional(),
        startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
        sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'priority', 'status']).default('createdAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
});

export const convertWishlistToTaskSchema = z.object({
    params: z.object({
        projectId: idSchema,
        wishlistId: idSchema,
    }),
    body: z.object({
        title: z.string().trim().min(1).max(300).optional(),
        description: z.string().trim().optional().nullable(),
        statusId: idSchema.optional(),
        stageId: idSchema.optional(),
        moduleId: idSchema.optional(),
        sprintId: idSchema.optional().nullable(),
        releaseId: idSchema.optional().nullable(),
        assignedToId: idSchema.optional().nullable(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        taskType: z.string().default('TASK'),
        criticality: z.enum(['NON_CRITICAL', 'CRITICAL']).default('NON_CRITICAL'),
        dueDate: z.string().or(z.date()).optional().nullable(),
        startDate: z.string().or(z.date()).optional().nullable(),
        deliveryDate: z.string().or(z.date()).optional().nullable(),
        estimatedTime: z.object({
            hours: z.number().min(0).default(0),
            minutes: z.number().min(0).max(59).default(0),
        }).optional(),
        tags: z.array(z.string().trim()).optional(),
    }).optional(),
});
