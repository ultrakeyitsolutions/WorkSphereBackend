import { Document, Types } from 'mongoose';

export type DomainVerificationStatus = 'NONE' | 'PENDING' | 'VERIFIED' | 'FAILED';

export interface IWhiteLabelTheme {
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    accentColor: string;
    sidebarBackground: string;
    sidebarText: string;
}

export interface IWhiteLabelLoginPage {
    heading?: string;
    subtitle?: string;
    bannerImageUrl?: string | null;
    backgroundImageUrl?: string | null;
    hideWorkSphereBranding?: boolean;
}

export interface IWhiteLabelSettings {
    tenantId: string;
    companyId: Types.ObjectId;
    enabled: boolean;
    displayName: string;
    logoUrl?: string | null;
    faviconUrl?: string | null;
    appTitle: string;
    theme: IWhiteLabelTheme;
    loginPage: IWhiteLabelLoginPage;
    customDomain?: string | null;
    domainVerificationStatus: DomainVerificationStatus;
    domainVerificationToken?: string | null;
    verifiedAt?: Date | null;
    updatedBy?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IWhiteLabelSettingsDocument extends IWhiteLabelSettings, Document {
    createdAt: Date;
    updatedAt: Date;
}

export interface PublicBrandingResponse {
    tenantId: string;
    companyId: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    appTitle: string;
    whiteLabelEnabled: boolean;
    theme: IWhiteLabelTheme;
    loginPage: IWhiteLabelLoginPage;
    customDomain?: string | null;
    domainVerified?: boolean;
}

export type TenantMemberStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export interface ITenantMembership {
    tenantId: string;
    companyId: Types.ObjectId;
    userId: Types.ObjectId;
    role: string;
    status: TenantMemberStatus;
    permissions?: string[];
    joinedAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ITenantMembershipDocument extends ITenantMembership, Document {
    createdAt: Date;
    updatedAt: Date;
}
