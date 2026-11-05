import { Response } from 'express';

export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
    code?: string;
    data?: T;
    errors?: any;
}

export const sendSuccess = <T = any>(
    res: Response,
    message: string,
    data?: T,
    statusCode = 200
): Response<ApiResponse<T>> => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
    });
};

export const sendError = (
    res: Response,
    message: string,
    statusCode = 500,
    errors?: any,
    code?: string
): Response<ApiResponse<never>> => {
    const payload: ApiResponse<never> = {
        success: false,
        message,
    };

    const resolvedCode = code || (errors && typeof errors === 'object' && !Array.isArray(errors) ? errors.code : undefined);
    if (resolvedCode) {
        payload.code = resolvedCode;
    }

    if (errors !== undefined) {
        payload.errors = errors;
    }

    return res.status(statusCode).json(payload);
};
