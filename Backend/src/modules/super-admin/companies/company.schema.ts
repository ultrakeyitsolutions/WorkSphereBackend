import { z } from 'zod';

// ─── Create Company Schema ─────────────────────────────────────────────────────
// Validates the entire POST /super-admin/companies request body.
// One payload creates both the Company document AND the COMPANY_ADMIN user.
export const createCompanySchema = z.object({
    // ── Company fields ──────────────────────────────────────────────────────
    companyName: z
        .string()
        .min(2, { message: 'Company name must be at least 2 characters' })
        .max(100, { message: 'Company name must be at most 100 characters' }),

    companyDomain: z
        .string()
        .url({ message: 'Company domain must be a valid URL (e.g. https://acme.com)' })
        .optional(),

    companyIndustry: z
        .string()
        .max(80, { message: 'Industry must be at most 80 characters' })
        .optional(),

    companySize: z
        .enum(['STARTUP', 'SME', 'ENTERPRISE'] as const, {
            message: 'companySize must be STARTUP, SME, or ENTERPRISE',
        })
        .optional(),

    logoUrl: z
        .string()
        .trim()
        .url({ message: 'Logo URL must be a valid URL' })
        .nullable()
        .optional()
        .or(z.literal('')),

    // ── Optional identifier and profile fields ─────────────────────────────
    tenantId: z.string().trim().max(100).optional(),
    slug: z.string().trim().max(100).optional(),
    companyEmail: z.string().trim().email({ message: 'Invalid company email address' }).toLowerCase().optional(),
    companyPhone: z.string().trim().max(30).optional(),
    contactNumber: z.string().trim().max(30).optional(),
    website: z.string().trim().url({ message: 'Invalid website URL' }).optional(),
    address: z.string().trim().max(250).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(30).optional(),
    timezone: z.string().trim().optional(),
    currency: z.string().trim().optional(),

    // ── Subscription plan ───────────────────────────────────────────────────
    subscriptionPlan: z.string().trim().optional(),
    planId: z.string().trim().optional(),

    // ── Company status ──────────────────────────────────────────────────────
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const).optional(),

    // ── White label configuration (flat or nested) ──────────────────────────
    whiteLabelEnabled: z.boolean().optional(),
    displayName: z.string().trim().max(100).optional(),
    faviconUrl: z.string().trim().url({ message: 'Favicon URL must be a valid URL' }).nullable().optional().or(z.literal('')),
    primaryColor: z.string().trim().optional(),
    secondaryColor: z.string().trim().optional(),
    backgroundColor: z.string().trim().optional(),
    textColor: z.string().trim().optional(),
    accentColor: z.string().trim().optional(),
    appTitle: z.string().trim().max(100).optional(),
    customDomain: z.string().trim().toLowerCase().optional(),
    emailSenderName: z.string().trim().max(100).optional(),

    whiteLabel: z.object({
        enabled: z.boolean().optional(),
        displayName: z.string().trim().max(100).optional(),
        logoUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
        faviconUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
        appTitle: z.string().trim().max(100).optional(),
        primaryColor: z.string().trim().optional(),
        secondaryColor: z.string().trim().optional(),
        backgroundColor: z.string().trim().optional(),
        textColor: z.string().trim().optional(),
        accentColor: z.string().trim().optional(),
        sidebarBackground: z.string().trim().optional(),
        sidebarText: z.string().trim().optional(),
        customDomain: z.string().trim().toLowerCase().optional(),
        loginPage: z.object({
            heading: z.string().trim().max(120).optional(),
            subtitle: z.string().trim().max(250).optional(),
            bannerImageUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
            backgroundImageUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
            hideWorkSphereBranding: z.boolean().optional(),
            customCss: z.string().max(10000).optional(),
        }).optional(),
        emailBranding: z.object({
            senderName: z.string().trim().max(100).optional(),
            senderEmail: z.string().trim().email().optional(),
            replyTo: z.string().trim().email().optional(),
            footerText: z.string().trim().max(500).optional(),
        }).optional(),
    }).optional(),

    // ── Admin user fields ───────────────────────────────────────────────────
    adminName: z
        .string()
        .min(2, { message: 'Admin name must be at least 2 characters' }),

    adminEmail: z
        .string()
        .email({ message: 'Admin email must be a valid email address' }),

    adminPassword: z
        .string()
        .min(8, { message: 'Admin password must be at least 8 characters' }),
});

export type CreateCompanyDto = z.infer<typeof createCompanySchema>;

// ─── Timezone & Currency Custom Validators ──────────────────────────────────
const timezoneValidator = (val: string): boolean => {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: val });
        return true;
    } catch {
        return false;
    }
};

const currencyValidator = (val: string): boolean => {
    try {
        new Intl.NumberFormat('en-US', { style: 'currency', currency: val });
        return true;
    } catch {
        return false;
    }
};

// ─── Edit Company Schema ──────────────────────────────────────────────────────
export const editCompanySchema = z.object({
    companyName: z.string().trim().min(2, { message: 'Company name must be at least 2 characters' }).max(100).optional(),
    industry: z.string().trim().max(80).optional(),
    companyEmail: z.string().trim().email({ message: 'Invalid email address' }).toLowerCase().optional(),
    companyPhone: z.string().trim().max(20).optional(),
    website: z.string().trim().url({ message: 'Invalid website URL' }).optional(),
    address: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    timezone: z.string().trim().refine(timezoneValidator, { message: 'Invalid IANA timezone' }).optional(),
    currency: z.string().trim().refine(currencyValidator, { message: 'Invalid ISO 4217 currency' }).optional(),
    logoUrl: z.string().trim().url({ message: 'Invalid logo URL' }).nullable().optional().or(z.literal('')),
}).strict();

export type EditCompanyDto = z.infer<typeof editCompanySchema>;

// ─── Suspend Company Schema ──────────────────────────────────────────────────
export const suspendCompanySchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();

export type SuspendCompanyDto = z.infer<typeof suspendCompanySchema>;

// ─── Company Admin Password Reset Schema ──────────────────────────────────────
export const companyAdminPasswordResetSchema = z.object({
    password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
}).strict();

export type CompanyAdminPasswordResetDto = z.infer<typeof companyAdminPasswordResetSchema>;
