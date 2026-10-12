import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

export const errorHandler = (
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Internal Server Error';

    if (err.name === 'ValidationError') {
        statusCode = 400;
        const messages = Object.values(err.errors || {}).map((e: any) => e.message).join(', ');
        message = messages ? `Validation Error: ${messages}` : err.message;
    }

    // Log error stack for debugging
    console.error(err);

    const errorPayload = err.errors !== undefined
        ? err.errors
        : (process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined);

    return sendError(
        res,
        message,
        statusCode,
        errorPayload
    );
};
export default errorHandler;
