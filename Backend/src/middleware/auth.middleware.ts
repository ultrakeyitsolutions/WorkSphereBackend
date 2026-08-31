import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokens';
import { sendError } from '../utils/response';
import { AuthenticatedRequest } from '../modules/auth/auth.types';

export const authenticate = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 'Authorization token is required', 401);
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return sendError(res, 'Authorization token is required', 401);
        }

        const decoded = verifyAccessToken(token);
        req.user = decoded;
        return next();
    } catch (error: any) {
        return sendError(res, 'Token is invalid or expired', 401);
    }
};
export default authenticate;
