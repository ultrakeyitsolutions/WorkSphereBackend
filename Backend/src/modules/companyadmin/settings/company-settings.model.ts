import { Schema, model } from 'mongoose';
import { ICompanySettingsDocument } from './company-settings.types';

export const DEFAULT_GENERAL_SETTINGS = {
    timezone: 'UTC',
    currency: 'USD',
    dateFormat: 'DD/MM/YYYY' as const,
    language: 'en',
};

export const DEFAULT_FEATURE_FLAGS = {
    enableLiveMonitoring: true,
    enableDetailedMonitoring: true,
    enableQuickMeetings: true,
    enableChat: true,
    enableAttendanceAdjustments: true,
    enableTimesheets: true,
    enableTaskAttachments: true,
};

export const DEFAULT_ATTENDANCE_POLICIES = {
    allowSelfServiceCheckIn: true,
    allowAttendanceAdjustments: true,
    requireGeofencing: false,
    requireBiometric: false,
    autoCheckOut: false,
    autoCheckOutTime: '20:00',
    overtimeThresholdMinutes: 480, // 8 hours
    halfDayThresholdMinutes: 240,   // 4 hours
};

export const DEFAULT_SECURITY_POLICIES = {
    minPasswordLength: 8,
    enforceAdminMfa: false,
    sessionTimeoutMinutes: 1440, // 24 hours
};

export const DEFAULT_EMAIL_SETTINGS = {
    mode: 'PLATFORM' as const,
    senderEmail: null,
    senderName: null,
    replyTo: null,
    isVerified: false,
    verifiedAt: null,
    verificationCodeHash: null,
    verificationCodeExpiresAt: null,
    verificationAttempts: 0,
    smtp: null,
};

const generalSettingsSchema = new Schema(
    {
        timezone: { type: String, default: DEFAULT_GENERAL_SETTINGS.timezone, trim: true },
        currency: { type: String, default: DEFAULT_GENERAL_SETTINGS.currency, trim: true },
        dateFormat: {
            type: String,
            enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'],
            default: DEFAULT_GENERAL_SETTINGS.dateFormat,
        },
        language: { type: String, default: DEFAULT_GENERAL_SETTINGS.language, trim: true },
    },
    { _id: false }
);

const featureFlagsSchema = new Schema(
    {
        enableLiveMonitoring: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableLiveMonitoring },
        enableDetailedMonitoring: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableDetailedMonitoring },
        enableQuickMeetings: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableQuickMeetings },
        enableChat: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableChat },
        enableAttendanceAdjustments: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableAttendanceAdjustments },
        enableTimesheets: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableTimesheets },
        enableTaskAttachments: { type: Boolean, default: DEFAULT_FEATURE_FLAGS.enableTaskAttachments },
    },
    { _id: false }
);

const attendancePoliciesSchema = new Schema(
    {
        allowSelfServiceCheckIn: { type: Boolean, default: DEFAULT_ATTENDANCE_POLICIES.allowSelfServiceCheckIn },
        allowAttendanceAdjustments: { type: Boolean, default: DEFAULT_ATTENDANCE_POLICIES.allowAttendanceAdjustments },
        requireGeofencing: { type: Boolean, default: DEFAULT_ATTENDANCE_POLICIES.requireGeofencing },
        requireBiometric: { type: Boolean, default: DEFAULT_ATTENDANCE_POLICIES.requireBiometric },
        autoCheckOut: { type: Boolean, default: DEFAULT_ATTENDANCE_POLICIES.autoCheckOut },
        autoCheckOutTime: { type: String, default: DEFAULT_ATTENDANCE_POLICIES.autoCheckOutTime },
        overtimeThresholdMinutes: { type: Number, default: DEFAULT_ATTENDANCE_POLICIES.overtimeThresholdMinutes },
        halfDayThresholdMinutes: { type: Number, default: DEFAULT_ATTENDANCE_POLICIES.halfDayThresholdMinutes },
    },
    { _id: false }
);

const securityPoliciesSchema = new Schema(
    {
        minPasswordLength: { type: Number, default: DEFAULT_SECURITY_POLICIES.minPasswordLength, min: 8, max: 64 },
        enforceAdminMfa: { type: Boolean, default: DEFAULT_SECURITY_POLICIES.enforceAdminMfa },
        sessionTimeoutMinutes: { type: Number, default: DEFAULT_SECURITY_POLICIES.sessionTimeoutMinutes, min: 15, max: 43200 },
    },
    { _id: false }
);

import { DEFAULT_COMPANY_THEME, DEFAULT_LIGHT_PALETTE, DEFAULT_DARK_PALETTE } from './company-theme.types';

const paletteSubSchema = new Schema(
    {
        sidebarBackground: { type: String, trim: true },
        sidebarText: { type: String, trim: true },
        sidebarMutedText: { type: String, trim: true },
        sidebarIcon: { type: String, trim: true },
        sidebarHoverBackground: { type: String, trim: true },
        sidebarHoverForeground: { type: String, trim: true },
        sidebarActiveBackground: { type: String, trim: true },
        sidebarActiveForeground: { type: String, trim: true },
        sidebarBorder: { type: String, trim: true },

        appBackground: { type: String, trim: true },
        cardBackground: { type: String, trim: true },
        cardForeground: { type: String, trim: true },

        brandPrimary: { type: String, trim: true },
        brandOnPrimary: { type: String, trim: true },
        buttonPrimaryBackground: { type: String, trim: true },
        buttonPrimaryForeground: { type: String, trim: true },
        buttonSecondaryBackground: { type: String, trim: true },
        buttonSecondaryForeground: { type: String, trim: true },

        inputBackground: { type: String, trim: true },
        inputForeground: { type: String, trim: true },
        inputBorder: { type: String, trim: true },
        focusRing: { type: String, trim: true },

        textPrimary: { type: String, trim: true },
        textSecondary: { type: String, trim: true },
        textMuted: { type: String, trim: true },
        borderColor: { type: String, trim: true },
        dividerColor: { type: String, trim: true },
        linkColor: { type: String, trim: true },

        successColor: { type: String, trim: true },
        warningColor: { type: String, trim: true },
        errorColor: { type: String, trim: true },
        infoColor: { type: String, trim: true },
    },
    { _id: false }
);

const themeSchema = new Schema(
    {
        version: { type: Number, default: 1 },
        light: {
            type: paletteSubSchema,
            default: () => ({ ...DEFAULT_LIGHT_PALETTE }),
        },
        dark: {
            type: paletteSubSchema,
            default: () => ({ ...DEFAULT_DARK_PALETTE }),
        },
        updatedAt: { type: Date, default: Date.now },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { _id: false }
);

const smtpSubSchema = new Schema(
    {
        host: { type: String, trim: true },
        port: { type: Number },
        secure: { type: Boolean, default: false },
        username: { type: String, trim: true },
        passwordEncrypted: { type: String },
    },
    { _id: false }
);

const emailSettingsSchema = new Schema(
    {
        mode: {
            type: String,
            enum: ['PLATFORM', 'COMPANY'],
            default: DEFAULT_EMAIL_SETTINGS.mode,
        },
        senderEmail: { type: String, trim: true, lowercase: true, default: null },
        senderName: { type: String, trim: true, default: null },
        replyTo: { type: String, trim: true, lowercase: true, default: null },
        isVerified: { type: Boolean, default: false },
        verifiedAt: { type: Date, default: null },
        verificationCodeHash: { type: String, default: null },
        verificationCodeExpiresAt: { type: Date, default: null },
        verificationAttempts: { type: Number, default: 0 },
        smtp: { type: smtpSubSchema, default: null },
        updatedAt: { type: Date, default: Date.now },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { _id: false }
);

const companySettingsSchema = new Schema<ICompanySettingsDocument>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            unique: true,
            index: true,
        },
        general: {
            type: generalSettingsSchema,
            default: () => ({ ...DEFAULT_GENERAL_SETTINGS }),
        },
        features: {
            type: featureFlagsSchema,
            default: () => ({ ...DEFAULT_FEATURE_FLAGS }),
        },
        attendancePolicies: {
            type: attendancePoliciesSchema,
            default: () => ({ ...DEFAULT_ATTENDANCE_POLICIES }),
        },
        securityPolicies: {
            type: securityPoliciesSchema,
            default: () => ({ ...DEFAULT_SECURITY_POLICIES }),
        },
        theme: {
            type: themeSchema,
            default: () => ({ ...DEFAULT_COMPANY_THEME }),
        },
        email: {
            type: emailSettingsSchema,
            default: () => ({ ...DEFAULT_EMAIL_SETTINGS }),
        },
        schemaVersion: {
            type: Number,
            default: 1,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: any) => {
                ret.id = ret._id ? ret._id.toString() : ret.id;
                delete ret.__v;
                return ret;
            },
        },
        toObject: { virtuals: true },
    }
);

export const CompanySettings = model<ICompanySettingsDocument>('CompanySettings', companySettingsSchema);
export default CompanySettings;
