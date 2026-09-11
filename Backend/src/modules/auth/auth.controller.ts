import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
    registerSchema,
    loginSchema,
    refreshSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
} from './auth.schema';
import { sendSuccess, sendError } from '../../utils/response';

export class AuthController {
    static async register(req: Request, res: Response) {
        try {
            const parsed = registerSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const user = await AuthService.register(parsed.data);
            return sendSuccess(
                res,
                'User registered successfully',
                {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    isActive: user.isActive,
                },
                201
            );
        } catch (error: any) {
            return sendError(res, error.message || 'Registration failed', 400);
        }
    }

    static async login(req: Request, res: Response) {
        try {
            const parsed = loginSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await AuthService.login(parsed.data, req);
            return sendSuccess(res, 'Login successful', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Login failed', 400);
        }
    }

    static async refresh(req: Request, res: Response) {
        try {
            const parsed = refreshSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await AuthService.refresh(parsed.data.refreshToken, req);
            return sendSuccess(res, 'Token refresh successful', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Token refresh failed', 401);
        }
    }

    /**
     * POST /auth/forgot-password (Public)
     * Sends a 6-digit numeric OTP to the user's email
     */
    static async forgotPassword(req: Request, res: Response) {
        try {
            const parsed = forgotPasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await AuthService.requestPasswordReset(parsed.data.email, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to process password reset request', 400);
        }
    }

    /**
     * POST /auth/reset-password (Public)
     * Validates the 6-digit code and sets a new strong password
     */
    static async resetPassword(req: Request, res: Response) {
        try {
            const parsed = resetPasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await AuthService.resetPassword(parsed.data, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Password reset failed', 400);
        }
    }
}
