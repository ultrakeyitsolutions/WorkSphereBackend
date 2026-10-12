import { z } from 'zod';

const dateFormatEnum = z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY']);

export const generalSettingsSchema = z.object({
    timezone: z.string().min(1).max(100).optional(),
    currency: z.string().min(1).max(10).optional(),
    dateFormat: dateFormatEnum.optional(),
    language: z.string().min(2).max(10).optional(),
}).strict();

export const featureFlagsSchema = z.object({
    enableLiveMonitoring: z.boolean().optional(),
    enableDetailedMonitoring: z.boolean().optional(),
    enableQuickMeetings: z.boolean().optional(),
    enableChat: z.boolean().optional(),
    enableAttendanceAdjustments: z.boolean().optional(),
    enableTimesheets: z.boolean().optional(),
    enableTaskAttachments: z.boolean().optional(),
}).strict();

export const attendancePoliciesSchema = z.object({
    allowSelfServiceCheckIn: z.boolean().optional(),
    allowAttendanceAdjustments: z.boolean().optional(),
    requireGeofencing: z.boolean().optional(),
    requireBiometric: z.boolean().optional(),
    autoCheckOut: z.boolean().optional(),
    autoCheckOutTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be valid HH:mm time').optional(),
    overtimeThresholdMinutes: z.number().int().min(60).max(1440).optional(),
    halfDayThresholdMinutes: z.number().int().min(60).max(720).optional(),
}).strict();

export const securityPoliciesSchema = z.object({
    minPasswordLength: z.number().int().min(8).max(64).optional(),
    enforceAdminMfa: z.boolean().optional(),
    sessionTimeoutMinutes: z.number().int().min(15).max(43200).optional(),
}).strict();

import { modePaletteSchema } from './company-theme.validator';
import { updateCompanyEmailSchema } from './company-email.validator';

export const updateCompanySettingsSchema = z.object({
    body: z.object({
        general: generalSettingsSchema.optional(),
        features: featureFlagsSchema.optional(),
        attendancePolicies: attendancePoliciesSchema.optional(),
        securityPolicies: securityPoliciesSchema.optional(),
        theme: z
            .object({
                light: modePaletteSchema.optional(),
                dark: modePaletteSchema.optional(),
            })
            .strict()
            .optional(),
        email: updateCompanyEmailSchema.shape.body.optional(),
    }).strict(),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>['body'];
