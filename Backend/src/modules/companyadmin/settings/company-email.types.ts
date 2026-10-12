import { Types } from 'mongoose';
import { SubscriptionStatus } from '../../super-admin/subscriptions/subscription.types';

export type EmailMode = 'PLATFORM' | 'COMPANY';

export type EmailEntitlementReasonCode =
    | 'ENTITLED'
    | 'PLAN_UPGRADE_REQUIRED'
    | 'SUBSCRIPTION_EXPIRED'
    | 'SUBSCRIPTION_INACTIVE'
    | 'SUBSCRIPTION_PAST_DUE'
    | 'NO_SUBSCRIPTION'
    | 'COMPANY_INACTIVE';

export interface IEmailEntitlementResult {
    isEntitled: boolean;
    reasonCode: EmailEntitlementReasonCode;
    message: string;
    planName?: string | null;
    billingCycle?: string | null;
    status?: SubscriptionStatus | null;
}

export interface ICompanySmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordEncrypted?: string;
}

export interface ICompanyEmailSettings {
    mode: EmailMode;
    senderEmail?: string | null;
    senderName?: string | null;
    replyTo?: string | null;
    isVerified: boolean;
    verifiedAt?: Date | null;
    verificationCodeHash?: string | null;
    verificationCodeExpiresAt?: Date | null;
    verificationAttempts?: number;
    smtp?: ICompanySmtpConfig | null;
    updatedAt?: Date;
    updatedBy?: Types.ObjectId | null;
}

export interface SanitizedSmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    hasPassword: boolean;
}

export interface SanitizedCompanyEmailSettings {
    mode: EmailMode;
    senderEmail: string | null;
    senderName: string | null;
    replyTo: string | null;
    isVerified: boolean;
    verifiedAt: Date | null;
    verificationPending: boolean;
    smtp: SanitizedSmtpConfig | null;
    platformDefault: {
        senderEmail: string;
        senderName: string;
    };
    effectiveSender: {
        mode: EmailMode | 'PLATFORM_AUTHORIZED_SENDER';
        from: string;
        replyTo?: string | null;
        description: string;
    };
}

export interface UpdateCompanyEmailDto {
    mode?: EmailMode;
    senderEmail?: string;
    senderName?: string;
    replyTo?: string;
    smtp?: {
        host: string;
        port: number;
        secure?: boolean;
        username: string;
        password?: string;
    };
}

export interface ConfirmEmailVerificationDto {
    code: string;
}

export interface SendTestEmailDto {
    recipientEmail?: string;
}
