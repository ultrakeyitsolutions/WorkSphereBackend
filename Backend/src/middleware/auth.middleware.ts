import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokens';
import { sendError } from '../utils/response';
import { AuthenticatedRequest } from '../modules/auth/auth.types';
import { User } from '../modules/users/user.model';
import { Company } from '../modules/companies/company.model';

export const authenticate = async (
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

        // Perform backend check on company status for non-SUPER_ADMIN users
        if (decoded.role !== 'SUPER_ADMIN') {
            const user = await (User.findById(decoded.userId) as any).populate('role');
            if (!user) {
                return sendError(res, 'User context not found', 401);
            }
            if (!user.isActive) {
                return sendError(res, 'User account is deactivated', 401);
            }
            if (user.companyId) {
                const company = await Company.findById(user.companyId);
                if (!company) {
                    return sendError(res, 'Organization not found', 401);
                }
                if (company.status === 'SUSPENDED') {
                    return sendError(res, 'Your organization account is currently suspended.', 403);
                }
                if (company.status === 'DELETED' || !company.isActive) {
                    return sendError(res, 'Your organization account is no longer active.', 403);
                }
            }
        }

        return next();
    } catch (error: any) {
        return sendError(res, 'Token is invalid or expired', 401);
    }
};
export default authenticate;
