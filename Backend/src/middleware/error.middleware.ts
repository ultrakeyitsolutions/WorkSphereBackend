import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

export const errorHandler = (
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';

    // Log error stack for debugging
    console.error(err);

    return sendError(
        res,
        message,
        statusCode,
        process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined
    );
};
export default errorHandler;
