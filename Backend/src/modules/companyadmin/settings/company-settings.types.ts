import { Document, Types } from 'mongoose';

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY';

export interface IGeneralSettings {
    timezone: string;
    currency: string;
    dateFormat: DateFormat;
    language: string;
}

export interface ICompanyFeatureFlags {
    enableLiveMonitoring: boolean;
    enableDetailedMonitoring: boolean;
    enableQuickMeetings: boolean;
    enableChat: boolean;
    enableAttendanceAdjustments: boolean;
    enableTimesheets: boolean;
    enableTaskAttachments: boolean;
}

export type FeatureFlagKey = keyof ICompanyFeatureFlags;

export interface IAttendancePolicies {
    allowSelfServiceCheckIn: boolean;
    allowAttendanceAdjustments: boolean;
    requireGeofencing: boolean;
    requireBiometric: boolean;
    autoCheckOut: boolean;
    autoCheckOutTime?: string; // HH:mm format, e.g. "20:00"
    overtimeThresholdMinutes: number;
    halfDayThresholdMinutes: number;
}

export interface ISecurityPolicies {
    minPasswordLength: number;
    enforceAdminMfa: boolean;
    sessionTimeoutMinutes: number;
}

import { ICompanyThemeConfig } from './company-theme.types';
import { ICompanyEmailSettings, UpdateCompanyEmailDto } from './company-email.types';

export interface ICompanySettings {
    companyId: Types.ObjectId;
    general: IGeneralSettings;
    features: ICompanyFeatureFlags;
    attendancePolicies: IAttendancePolicies;
    securityPolicies: ISecurityPolicies;
    theme?: ICompanyThemeConfig;
    email?: ICompanyEmailSettings;
    schemaVersion: number;
    updatedBy?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICompanySettingsDocument extends ICompanySettings, Document {
    _id: Types.ObjectId;
}

export interface UpdateCompanySettingsDto {
    general?: Partial<IGeneralSettings>;
    features?: Partial<ICompanyFeatureFlags>;
    attendancePolicies?: Partial<IAttendancePolicies>;
    securityPolicies?: Partial<ISecurityPolicies>;
    theme?: {
        light?: Record<string, string>;
        dark?: Record<string, string>;
    };
    email?: UpdateCompanyEmailDto;
}

