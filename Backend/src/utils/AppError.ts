/**
 * Operational error with an explicit HTTP status code.
 * Throw this from services/controllers; the global error handler
 * will forward `statusCode` directly to the response.
 *
 * WorkSphere status-code standard:
 *  400 – Bad Request        (malformed request)
 *  401 – Unauthorized       (missing / invalid auth)
 *  403 – Forbidden          (authenticated, no permission)
 *  404 – Not Found          (resource doesn't exist)
 *  409 – Conflict           (duplicate / conflicting state)
 *  422 – Unprocessable      (valid syntax, failed business validation)
 *  429 – Too Many Requests  (rate limit)
 *  500 – Internal Server Error
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public errors?: any;

    constructor(message: string, statusCode: number, errors?: any) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.isOperational = true;
        this.errors = errors;
        Error.captureStackTrace(this, this.constructor);
    }

    // ── Convenience factories ─────────────────────────────────────────────────

    static badRequest(message: string, errors?: any): AppError {
        return new AppError(message, 400, errors);
    }

    static unauthorized(message: string): AppError {
        return new AppError(message, 401);
    }

    static forbidden(message: string): AppError {
        return new AppError(message, 403);
    }

    static notFound(message: string): AppError {
        return new AppError(message, 404);
    }

    static conflict(message: string): AppError {
        return new AppError(message, 409);
    }

    static unprocessable(message: string, errors?: any): AppError {
        return new AppError(message, 422, errors);
    }

    static internal(message = 'Internal Server Error'): AppError {
        return new AppError(message, 500);
    }
}
