import { Schema, model } from 'mongoose';
import {
    IWhiteLabelSettingsDocument,
    IWhiteLabelTheme,
    IWhiteLabelLoginPage,
} from './white-label.types';
import { CloudinaryStorageProvider } from '../../../infrastructure/storage/providers/cloudinary-storage.provider';

export const DEFAULT_WHITE_LABEL_THEME: IWhiteLabelTheme = {
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    backgroundColor: '#F9FAFB',
    textColor: '#111827',
    accentColor: '#6366F1',
    sidebarBackground: '#1E293B',
    sidebarText: '#F8FAFC',
};

export const DEFAULT_WHITE_LABEL_LOGIN: IWhiteLabelLoginPage = {
    heading: 'Welcome to WorkSphere',
    subtitle: 'Sign in to access your team workspace and projects',
    bannerImageUrl: null,
    backgroundImageUrl: null,
    hideWorkSphereBranding: false,
};

// Email branding feature removed. Kept as null export so any lingering
// imports elsewhere won't cause a runtime crash (TS will still flag them).
export const DEFAULT_WHITE_LABEL_EMAIL = null;

const resolveCloudinaryDeliveryUrl = (val: string | null | undefined): string | null | undefined => {
    if (typeof val === 'string' && val.startsWith('cloudinary://')) {
        return CloudinaryStorageProvider.toHttpsDeliveryUrl(val);
    }
    return val;
};

const themeSchema = new Schema(
    {
        primaryColor: { type: String, default: DEFAULT_WHITE_LABEL_THEME.primaryColor, trim: true },
        secondaryColor: { type: String, default: DEFAULT_WHITE_LABEL_THEME.secondaryColor, trim: true },
        backgroundColor: { type: String, default: DEFAULT_WHITE_LABEL_THEME.backgroundColor, trim: true },
        textColor: { type: String, default: DEFAULT_WHITE_LABEL_THEME.textColor, trim: true },
        accentColor: { type: String, default: DEFAULT_WHITE_LABEL_THEME.accentColor, trim: true },
        sidebarBackground: { type: String, default: DEFAULT_WHITE_LABEL_THEME.sidebarBackground, trim: true },
        sidebarText: { type: String, default: DEFAULT_WHITE_LABEL_THEME.sidebarText, trim: true },
    },
    { _id: false }
);

const loginPageSchema = new Schema(
    {
        heading: { type: String, default: DEFAULT_WHITE_LABEL_LOGIN.heading, trim: true },
        subtitle: { type: String, default: DEFAULT_WHITE_LABEL_LOGIN.subtitle, trim: true },
        bannerImageUrl: {
            type: String,
            default: null,
            trim: true,
            set: resolveCloudinaryDeliveryUrl,
            get: resolveCloudinaryDeliveryUrl,
        },
        backgroundImageUrl: {
            type: String,
            default: null,
            trim: true,
            set: resolveCloudinaryDeliveryUrl,
            get: resolveCloudinaryDeliveryUrl,
        },
        hideWorkSphereBranding: { type: Boolean, default: false },
        // customCss field intentionally removed — feature not supported.
    },
    { _id: false }
);

const whiteLabelSettingsSchema = new Schema<IWhiteLabelSettingsDocument>(
    {
        tenantId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            unique: true,
            index: true,
        },
        enabled: {
            type: Boolean,
            default: false,
            index: true,
        },
        displayName: {
            type: String,
            required: true,
            trim: true,
        },
        logoUrl: {
            type: String,
            default: null,
            trim: true,
            set: resolveCloudinaryDeliveryUrl,
            get: resolveCloudinaryDeliveryUrl,
        },
        faviconUrl: {
            type: String,
            default: null,
            trim: true,
            set: resolveCloudinaryDeliveryUrl,
            get: resolveCloudinaryDeliveryUrl,
        },
        appTitle: {
            type: String,
            default: 'WorkSphere',
            trim: true,
        },
        theme: {
            type: themeSchema,
            default: () => ({ ...DEFAULT_WHITE_LABEL_THEME }),
        },
        loginPage: {
            type: loginPageSchema,
            default: () => ({ ...DEFAULT_WHITE_LABEL_LOGIN }),
        },
        // emailBranding field intentionally removed — feature not supported.
        customDomain: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            sparse: true,
            unique: true,
        },
        domainVerificationStatus: {
            type: String,
            enum: ['NONE', 'PENDING', 'VERIFIED', 'FAILED'],
            default: 'NONE',
            index: true,
        },
        domainVerificationToken: {
            type: String,
            default: null,
            trim: true,
        },
        verifiedAt: {
            type: Date,
            default: null,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { getters: true },
        toObject: { getters: true },
    }
);

whiteLabelSettingsSchema.index({ customDomain: 1, domainVerificationStatus: 1 });

export const WhiteLabelSettings = model<IWhiteLabelSettingsDocument>(
    'WhiteLabelSettings',
    whiteLabelSettingsSchema
);

export default WhiteLabelSettings;
