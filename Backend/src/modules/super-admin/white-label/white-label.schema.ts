import { z } from 'zod';

const colorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$|^hsl\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*\)$/;

const colorStringSchema = z
    .string()
    .trim()
    .refine((val) => colorRegex.test(val), {
        message: 'Must be a valid hex (#RGB or #RRGGBB), rgb(), or hsl() color string',
    });

const urlOrEmptySchema = z
    .string()
    .trim()
    .url({ message: 'Must be a valid URL' })
    .nullable()
    .optional()
    .or(z.literal(''));

export const whiteLabelThemeSchema = z.object({
    primaryColor: colorStringSchema.optional(),
    secondaryColor: colorStringSchema.optional(),
    backgroundColor: colorStringSchema.optional(),
    textColor: colorStringSchema.optional(),
    accentColor: colorStringSchema.optional(),
    sidebarBackground: colorStringSchema.optional(),
    sidebarText: colorStringSchema.optional(),
});

export const whiteLabelLoginPageSchema = z.object({
    heading: z.string().trim().max(120).optional(),
    subtitle: z.string().trim().max(250).optional(),
    bannerImageUrl: urlOrEmptySchema,
    backgroundImageUrl: urlOrEmptySchema,
    hideWorkSphereBranding: z.boolean().optional(),
    // customCss intentionally removed — feature not supported.
});

export const updateWhiteLabelSchema = z.object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(2).max(100).optional(),
    logoUrl: urlOrEmptySchema,
    faviconUrl: urlOrEmptySchema,
    appTitle: z.string().trim().min(2).max(100).optional(),
    theme: whiteLabelThemeSchema.optional(),
    loginPage: whiteLabelLoginPageSchema.optional(),
    // emailBranding intentionally removed — feature not supported.
    customDomain: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, {
            message: 'Must be a valid domain name (e.g. workspace.acme.com)',
        })
        .nullable()
        .optional()
        .or(z.literal('')),
});

export type UpdateWhiteLabelDto = z.infer<typeof updateWhiteLabelSchema>;

export const configureDomainSchema = z.object({
    domain: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, {
            message: 'Must be a valid domain name (e.g. portal.acme.com)',
        }),
});

export type ConfigureDomainDto = z.infer<typeof configureDomainSchema>;

export const verifyDomainSchema = z.object({
    verificationType: z.enum(['DNS_TXT', 'CNAME', 'TOKEN']).optional().default('TOKEN'),
});

export type VerifyDomainDto = z.infer<typeof verifyDomainSchema>;

export const switchTenantSchema = z.object({
    targetTenantId: z.string().trim().optional(),
    targetCompanyId: z.string().trim().optional(),
    targetSlug: z.string().trim().optional(),
}).refine(
    (data) => Boolean(data.targetTenantId || data.targetCompanyId || data.targetSlug),
    { message: 'Must supply at least one of targetTenantId, targetCompanyId, or targetSlug' }
);

export type SwitchTenantDto = z.infer<typeof switchTenantSchema>;
