import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { registerSchema, loginSchema, refreshSchema } from './auth.schema';
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

            const result = await AuthService.login(parsed.data);
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

            const result = await AuthService.refresh(parsed.data.refreshToken);
            return sendSuccess(res, 'Token refresh successful', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Token refresh failed', 401);
        }
    }
}
