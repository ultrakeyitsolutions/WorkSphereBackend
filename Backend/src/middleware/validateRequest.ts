import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { sendError } from '../utils/response';

export const validateRequest = (schema: ZodSchema<any>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const parsed = schema.safeParse({
            body: req.body,
            query: req.query,
            params: req.params,
        });

        if (!parsed.success) {
            return sendError(res, 'Validation Error', 400, parsed.error.format());
        }

        // optionally replace req properties with validated ones
        req.body = parsed.data.body;
        if (parsed.data.query) req.query = parsed.data.query;
        if (parsed.data.params) req.params = parsed.data.params;

        next();
    };
};
