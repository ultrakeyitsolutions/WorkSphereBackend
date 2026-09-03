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
            return sendError(res, 'Validation Error', 422, (parsed.error as ZodError).format());
        }

        // replace req properties with validated (and stripped/transformed) ones safely
        if (parsed.data.body !== undefined) {
            req.body = parsed.data.body;
        }
        if (parsed.data.query !== undefined) {
            Object.defineProperty(req, 'query', {
                value: parsed.data.query,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
        if (parsed.data.params !== undefined) {
            Object.defineProperty(req, 'params', {
                value: parsed.data.params,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }

        next();
    };
};
