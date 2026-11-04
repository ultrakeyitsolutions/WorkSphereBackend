import { Request } from 'express';
import { TokenPayload } from '../../utils/tokens';

export interface AuthenticatedUserContext {
    userId: string;
    email?: string;
    role: string;
    tenantId?: string;
    tenantSlug?: string;
}

export interface EffectiveUserContext {
    userId: string;
    email?: string;
    role: string;
    companyId?: string;
    tenantId?: string;
    tenantSlug?: string;
}

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
    authenticatedUser?: AuthenticatedUserContext;
    currentUser?: EffectiveUserContext;
    tenantId?: string;
    tenantSlug?: string;
    resolvedTenant?: any;
    isImpersonating?: boolean;
    impersonationSessionId?: string;
}

