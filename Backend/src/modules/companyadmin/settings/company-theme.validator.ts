/**
 * WorkSphere — Company Theme Customization Validator
 * Validates theme tokens, color formats, bounds, and ensures safety against injection.
 */

import { z } from 'zod';
import {
    PALETTE_KEY_SET,
    KEBAB_TO_CAMEL_MAP,
    PaletteKey,
} from './company-theme.types';

// Strict color format:
// 1. Hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
// 2. rgb(r, g, b) or rgba(r, g, b, a)
// Disallows CSS expressions, URLs, imports, quotes, etc.
const COLOR_REGEX = /^(?:#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;

export const colorStringSchema = z
    .string()
    .trim()
    .min(3, 'Color string too short')
    .max(40, 'Color string cannot exceed 40 characters')
    .refine((val) => COLOR_REGEX.test(val), {
        message: 'Invalid color format. Must be a valid HEX (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or rgb/rgba string.',
    });

/**
 * Validates a mode palette object (e.g., light or dark).
 * Ensures every key is a recognized semantic token (camelCase or kebab-case),
 * and values are valid color formats. Unknown keys are strictly rejected.
 */
export const modePaletteSchema = z
    .record(z.string(), z.any())
    .refine(
        (record) => {
            const keys = Object.keys(record);
            return keys.length <= 32;
        },
        { message: 'Exceeded maximum allowed token count of 32 per mode.' }
    )
    .superRefine((record, ctx) => {
        for (const [key, val] of Object.entries(record)) {
            const normalizedKey = KEBAB_TO_CAMEL_MAP[key] || key;
            if (!PALETTE_KEY_SET.has(normalizedKey)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Unrecognized theme token key: '${key}'. Unknown properties are not accepted.`,
                    path: [key],
                });
                continue;
            }

            if (typeof val !== 'string') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Value for token '${key}' must be a string color value.`,
                    path: [key],
                });
                continue;
            }

            const parsed = colorStringSchema.safeParse(val);
            if (!parsed.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Invalid color value for '${key}': ${parsed.error.issues[0]?.message || 'Invalid format'}`,
                    path: [key],
                });
            }
        }
    });

/**
 * Schema for updating company theme.
 * Accepts either:
 * { light?: { ... }, dark?: { ... } }
 * or { theme: { light?: { ... }, dark?: { ... } } }
 */
export const updateCompanyThemeSchema = z.object({
    body: z
        .object({
            light: modePaletteSchema.optional(),
            dark: modePaletteSchema.optional(),
            theme: z
                .object({
                    light: modePaletteSchema.optional(),
                    dark: modePaletteSchema.optional(),
                })
                .strip()
                .optional(),
            companyId: z.string().optional(),
            updatedAt: z.any().optional(),
            updatedBy: z.any().optional(),
            createdAt: z.any().optional(),
            version: z.any().optional(),
            _id: z.any().optional(),
            id: z.any().optional(),
        })
        .strip()
        .refine(
            (data) => {
                const hasDirect = Boolean(data.light || data.dark);
                const hasNested = Boolean(data.theme && (data.theme.light || data.theme.dark));
                return hasDirect || hasNested;
            },
            { message: 'Request must include at least one mode palette to update (light or dark).' }
        ),
});

export type UpdateCompanyThemeInput = z.infer<typeof updateCompanyThemeSchema>['body'];

/**
 * Normalizes input palette tokens by converting any kebab-case keys to camelCase.
 */
export function normalizePaletteTokens(
    rawTokens?: Record<string, string>
): Partial<Record<PaletteKey, string>> {
    if (!rawTokens) return {};
    const normalized: Partial<Record<PaletteKey, string>> = {};

    for (const [key, val] of Object.entries(rawTokens)) {
        const canonicalKey = KEBAB_TO_CAMEL_MAP[key] || (key as PaletteKey);
        if (PALETTE_KEY_SET.has(canonicalKey)) {
            normalized[canonicalKey] = val.trim();
        }
    }

    return normalized;
}
