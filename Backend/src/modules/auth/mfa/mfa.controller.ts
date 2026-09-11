import { Request, Response } from 'express';
import { MfaService } from './mfa.service';
import {
    mfaSetupVerifySchema,
    mfaVerifySchema,
    mfaRecoverySchema,
    mfaDisableSchema,
} from './mfa.schema';
import { AuthService } from '../auth.service';
import { UserService } from '../../users/user.service';
import { sendSuccess, sendError } from '../../../utils/response';
import { AuthenticatedRequest } from '../auth.types';

export class MfaController {
    /**
     * POST /auth/mfa/setup (Requires login / Bearer token)
     * Generates TOTP secret, otpauth URI, and QR code
     */
    static async setup(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            const email = req.user?.email;

            if (!userId || !email) {
                return sendError(res, 'Authentication required', 401);
            }

            const result = await MfaService.generateSetup(userId, email, req);
            return sendSuccess(res, 'MFA setup initiated successfully', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to initiate MFA setup', 400);
        }
    }

    /**
     * POST /auth/mfa/email-key (Requires login / Bearer token)
     * Re-sends the manual setup key to user's registered email
     */
    static async sendManualKeyEmail(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const result = await MfaService.sendManualKeyToEmail(userId, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to send setup key to email', 400);
        }
    }

    /**
     * POST /auth/mfa/setup/verify (Requires login / Bearer token)
     * Verifies the first 6-digit code to enable MFA and returns 8 recovery codes
     */
    static async verifySetup(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const parsed = mfaSetupVerifySchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await MfaService.verifySetup(userId, parsed.data.code, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to verify MFA setup', 400);
        }
    }

    /**
     * POST /auth/mfa/verify (Public - uses challengeId)
     * Verifies 6-digit code after password verification and issues tokens + creates session
     */
    static async verify(req: Request, res: Response) {
        try {
            const parsed = mfaVerifySchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const { user } = await MfaService.verifyChallenge(
                parsed.data.challengeId,
                parsed.data.code,
                req
            );

            // Fetch populated user to build JWT tokens & role/permissions
            const populatedUser = await UserService.findById(String(user._id));
            if (!populatedUser) {
                return sendError(res, 'User not found', 404);
            }

            const authResult = await AuthService.generateAuthSessionResponse(
                populatedUser,
                req,
                new Date()
            );

            return sendSuccess(res, 'MFA verification successful', authResult);
        } catch (error: any) {
            return sendError(res, error.message || 'MFA verification failed', 400);
        }
    }

    /**
     * POST /auth/mfa/recovery (Public - uses challengeId)
     * Verifies single-use backup recovery code and issues tokens
     */
    static async recovery(req: Request, res: Response) {
        try {
            const parsed = mfaRecoverySchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const { user, remainingRecoveryCodes } = await MfaService.verifyRecoveryCode(
                parsed.data.challengeId,
                parsed.data.recoveryCode,
                req
            );

            const populatedUser = await UserService.findById(String(user._id));
            if (!populatedUser) {
                return sendError(res, 'User not found', 404);
            }

            const authResult = await AuthService.generateAuthSessionResponse(
                populatedUser,
                req,
                new Date()
            );

            return sendSuccess(res, 'Recovery code accepted. Login successful.', {
                ...authResult,
                remainingRecoveryCodes,
            });
        } catch (error: any) {
            return sendError(res, error.message || 'Recovery code verification failed', 400);
        }
    }

    /**
     * GET /auth/mfa/status (Requires login)
     * Check if MFA is enabled and details
     */
    static async status(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const result = await MfaService.getMfaStatus(userId);
            return sendSuccess(res, 'MFA status retrieved', result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve MFA status', 400);
        }
    }

    /**
     * POST /auth/mfa/recovery/regenerate (Requires login)
     * Regenerates 8 new recovery codes
     */
    static async regenerateRecovery(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const result = await MfaService.regenerateRecoveryCodes(userId, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to regenerate recovery codes', 400);
        }
    }

    /**
     * POST /auth/mfa/disable (Requires login and 6-digit code)
     */
    static async disable(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return sendError(res, 'Authentication required', 401);
            }

            const parsed = mfaDisableSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(res, 'Validation Error', 400, parsed.error.format());
            }

            const result = await MfaService.disableMfa(userId, parsed.data.code, req);
            return sendSuccess(res, result.message, result);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to disable MFA', 400);
        }
    }
}
