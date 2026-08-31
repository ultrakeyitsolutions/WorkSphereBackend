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
