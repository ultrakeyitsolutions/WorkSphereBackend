import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sendError } from '../utils/response';

/**
 * Validates a payload directly.
 */
export const validateData = (
    schema: ZodSchema<any>,
    data: unknown
): { success: true; data: any } | { success: false; errors: any } => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        return { success: false, errors: (parsed.error as ZodError).format() };
    }
    return { success: true, data: parsed.data };
};

/**
 * Express middleware factory — validates req.body / req.query / req.params
 * using a Zod schema that wraps all three.
 */
export const validateRequest = (schema: ZodSchema<any>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const parsed = schema.safeParse({
            body: req.body,
            query: req.query,
            params: req.params,
        });

        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, (parsed.error as ZodError).format());
        }

        // optionally replace req properties with validated ones
        req.body = parsed.data.body;
        if (parsed.data.query) req.query = parsed.data.query;
        if (parsed.data.params) req.params = parsed.data.params;

        next();
    };
};
