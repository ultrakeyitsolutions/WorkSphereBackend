import { Request } from 'express';
import { TokenPayload } from '../../utils/tokens';

export interface AuthenticatedUserContext {
    userId: string;
    email?: string;
    role: string;
}

export interface EffectiveUserContext {
    userId: string;
    email?: string;
    role: string;
    companyId?: string;
}

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
    authenticatedUser?: AuthenticatedUserContext;
    currentUser?: EffectiveUserContext;
    isImpersonating?: boolean;
    impersonationSessionId?: string;
}

