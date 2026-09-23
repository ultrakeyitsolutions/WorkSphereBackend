import { Document, Types } from 'mongoose';

export enum ImpersonationStatus {
    ACTIVE = 'ACTIVE',
    ENDED = 'ENDED',
    EXPIRED = 'EXPIRED',
}

export interface IImpersonationSession {
    sessionId: string;
    originalUserId: Types.ObjectId;
    targetUserId: Types.ObjectId;
    targetCompanyId?: Types.ObjectId | null;
    status: ImpersonationStatus;
    startedAt: Date;
    endedAt?: Date | null;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IImpersonationSessionDocument extends IImpersonationSession, Document {
    _id: Types.ObjectId;
}

export interface StartImpersonationDto {
    targetUserId: string;
}

export interface ImpersonationStartResponse {
    isImpersonating: true;
    authenticatedUserId: string;
    impersonatedUserId: string;
    companyId: string | null;
    role: string;
    accessToken: string;
    refreshToken: string;
    session: {
        sessionId: string;
        expiresAt: Date;
        startedAt: Date;
    };
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
        companyId: string | null;
    };
}

export interface ImpersonationStopResponse {
    isImpersonating: false;
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
        companyId: string | null;
    };
    accessToken: string;
    refreshToken: string;
}

export interface CurrentImpersonationResponse {
    isImpersonating: boolean;
    originalUser?: {
        id: string;
        email: string;
        role: string;
    };
    targetUser?: {
        id: string;
        name: string;
        email: string;
        role: string;
    };
    company?: {
        id: string;
        name: string;
    } | null;
    startedAt?: Date;
    expiresAt?: Date;
}
