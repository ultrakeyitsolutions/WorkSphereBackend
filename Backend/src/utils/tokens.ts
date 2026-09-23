import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
    userId: string;
    email: string;
    role: string;
    /** Set for company-member users so controllers can always derive it from the token */
    companyId?: string;

    // JWT standard & Impersonation specific
    sub?: string;
    authUserId?: string;
    effectiveUserId?: string;
    sessionUserId?: string;
    isImpersonating?: boolean;
    impersonationSessionId?: string;
    sessionType?: 'NORMAL' | 'IMPERSONATION';
    impersonatedBy?: string;
}


export const generateAccessToken = (payload: TokenPayload): string => {
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
};

export const generateRefreshToken = (payload: TokenPayload): string => {
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

export const verifyAccessToken = (token: string): TokenPayload => {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
};
