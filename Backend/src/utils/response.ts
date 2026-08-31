import { Response } from 'express';

export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
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
    errors?: any
): Response<ApiResponse<never>> => {
    return res.status(statusCode).json({
        success: false,
        message,
        errors,
    });
};
