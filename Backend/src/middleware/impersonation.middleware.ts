import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { sendError } from '../utils/response';

/**
 * Middleware that blocks dangerous or sensitive operations (e.g. MFA setup/disable,
 * password modification, credential alterations, nested impersonation, account deletions)
 * while an impersonation session is active.
 */
export const blockImpersonatedOperations = (customMessage?: string) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (req.isImpersonating || req.user?.isImpersonating || req.user?.sessionType === 'IMPERSONATION') {
            return sendError(
                res,
                customMessage || 'This operation is not allowed during impersonation',
                403
            );
        }
        return next();
    };
};

export default blockImpersonatedOperations;
