import { z } from 'zod';
import { normalizeModuleKey } from './module-access.constants';

export const moduleKeyEnum = z.preprocess((val) => {
    if (typeof val === 'string') {
        const normalized = normalizeModuleKey(val);
        return normalized || val;
    }
    return val;
}, z.enum([
    'dashboard',
    'attendance',
    'projects',
    'tasks',
    'dropbox',
    'chat',
    'meetings',
    'live-monitoring',
    'detailed-monitoring',
    'timesheet',
    'leave',
    'reports',
    'user-reviews',
    'status-updates',
    'calendar',
    'shifts',
]));

export const overrideStateEnum = z.preprocess((val) => {
    if (typeof val === 'boolean') {
        return val ? 'ENABLED' : 'DISABLED';
    }
    if (typeof val === 'string') {
        const upper = val.trim().toUpperCase();
        if (upper === 'TRUE') return 'ENABLED';
        if (upper === 'FALSE') return 'DISABLED';
        if (['INHERIT', 'ENABLED', 'DISABLED'].includes(upper)) {
            return upper;
        }
    }
    if (val === null || val === undefined) {
        return 'INHERIT';
    }
    return val;
}, z.enum(['INHERIT', 'ENABLED', 'DISABLED']));

export const updateGlobalModuleAccessSchema = z.object({
    body: z.object({
        modules: z.record(moduleKeyEnum, z.boolean()).refine(
            (data) => Object.keys(data).length > 0,
            { message: 'At least one module setting must be provided' }
        ),
    }).strict(),
});

export const updateEmployeeOverrideSchema = z.object({
    params: z.object({
        employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format'),
    }),
    body: z.object({
        overrides: z.record(moduleKeyEnum, overrideStateEnum).optional(),
        modules: z.record(moduleKeyEnum, z.boolean()).optional(),
    }).strict().refine(
        (data) =>
            (Boolean(data.overrides) && Object.keys(data.overrides || {}).length > 0) ||
            (Boolean(data.modules) && Object.keys(data.modules || {}).length > 0),
        { message: 'At least one override or module setting must be provided' }
    ),
});

export const bulkUpdateEmployeeOverridesSchema = z.object({
    body: z.object({
        employeeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format')).optional(),
        memberIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid member ID format')).optional(),
        action: z.enum(['SET', 'RESET', 'ENABLE', 'DISABLE']).optional(),
        moduleKey: moduleKeyEnum.optional(),
        overrides: z.record(moduleKeyEnum, overrideStateEnum).optional(),
        modules: z.record(moduleKeyEnum, z.boolean()).optional(),
    }).strict().refine((data) => {
        const ids = data.employeeIds || data.memberIds;
        return Array.isArray(ids) && ids.length > 0;
    }, {
        message: 'At least one employee ID or member ID is required',
    }).refine((data) => {
        if (data.action && ['ENABLE', 'DISABLE', 'RESET'].includes(data.action)) {
            return Boolean(data.moduleKey);
        }
        const hasOverrides = Boolean(data.overrides) && Object.keys(data.overrides || {}).length > 0;
        const hasModules = Boolean(data.modules) && Object.keys(data.modules || {}).length > 0;
        return hasOverrides || hasModules;
    }, {
        message: 'Either (action + moduleKey) or an overrides/modules object must be provided',
    }),
});

export const selectedMembersQuerySchema = z.object({
    body: z.object({
        employeeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format')).optional(),
        memberIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid member ID format')).optional(),
    }).strict().refine((data) => {
        const ids = data.employeeIds || data.memberIds;
        return Array.isArray(ids) && ids.length > 0;
    }, {
        message: 'At least one employee ID or member ID must be provided',
    }),
});

export const resetEmployeeOverrideParamsSchema = z.object({
    params: z.object({
        employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format'),
        moduleKey: moduleKeyEnum,
    }),
});

export type UpdateGlobalModuleAccessInput = z.infer<typeof updateGlobalModuleAccessSchema>['body'];
export type UpdateEmployeeOverrideInput = z.infer<typeof updateEmployeeOverrideSchema>['body'];
export type BulkUpdateEmployeeOverridesInput = z.infer<typeof bulkUpdateEmployeeOverridesSchema>['body'];
export type SelectedMembersQueryInput = z.infer<typeof selectedMembersQuerySchema>['body'];
