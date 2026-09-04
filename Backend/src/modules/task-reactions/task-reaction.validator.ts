import { z } from 'zod';

const idSchema = z.string().min(1, 'Invalid ID');

export const addReactionSchema = z.object({
    params: z.object({
        activityId: idSchema
    }),
    body: z.object({
        reaction: z.string().min(1, 'Reaction string is required')
    })
});

export const reactionParamSchema = z.object({
    params: z.object({
        activityId: idSchema,
        reaction: z.string().min(1)
    })
});
