import { z } from 'zod';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationCaseStatus,
    EscalationResetPeriod,
} from '../constants/escalation.constants';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, 'Invalid ObjectId format');

export const escalationLevelConfigSchema = z.object({
    level: z.number().int().min(1).max(10),
    name: z.string().min(1, 'Level name is required').max(100),
    notifyRole: z.string().min(1, 'Notify role is required'),
    notifyUserIds: z.array(objectIdSchema).optional().default([]),
    deadlineHours: z.number().min(1).max(720).optional().default(48),
});

export const createEscalationRuleSchema = z.object({
    ruleName: z.string().min(2, 'Rule name must be at least 2 characters').max(120),
    category: z.nativeEnum(EscalationCategory),
    description: z.string().max(1000).optional().default(''),
    isEnabled: z.boolean().optional().default(true),
    severity: z.nativeEnum(EscalationSeverity).optional().default(EscalationSeverity.MEDIUM),
    gracePeriod: z.number().min(0).max(1440).optional().default(15),
    thresholds: z.object({
        maxViolationDuration: z.number().min(0).optional().default(0),
        occurrenceThreshold: z.number().min(1).max(100).optional().default(1),
        idleThresholdMinutes: z.number().min(1).max(1440).optional().default(30),
        breakDurationLimitMinutes: z.number().min(1).max(1440).optional().default(60),
        reopenCountThreshold: z.number().min(1).max(50).optional().default(2),
        projectDelayDays: z.number().min(1).max(365).optional().default(3),
        consecutiveDaysThreshold: z.number().min(1).max(30).optional().default(3),
        customMetricThreshold: z.number().min(0).optional().default(0),
    }).default({
        maxViolationDuration: 0,
        occurrenceThreshold: 1,
        idleThresholdMinutes: 30,
        breakDurationLimitMinutes: 60,
        reopenCountThreshold: 2,
        projectDelayDays: 3,
        consecutiveDaysThreshold: 3,
        customMetricThreshold: 0,
    }),
    escalationLevels: z.array(escalationLevelConfigSchema).min(1).optional(),
    resetPeriod: z.nativeEnum(EscalationResetPeriod).optional().default(EscalationResetPeriod.MONTHLY),
    notificationRecipients: z.array(objectIdSchema).optional().default([]),
    applicableDepartments: z.array(objectIdSchema).optional().default([]),
    applicableEmployees: z.array(objectIdSchema).optional().default([]),
    applicableShifts: z.array(objectIdSchema).optional().default([]),
    resolutionDeadline: z.number().min(1).max(720).optional().default(48),
});

export const updateEscalationRuleSchema = createEscalationRuleSchema.partial();

export const toggleRuleStatusSchema = z.object({
    isEnabled: z.boolean(),
});

export const caseAcknowledgeSchema = z.object({
    comment: z.string().max(1000).optional(),
});

export const caseAssignSchema = z.object({
    managerId: objectIdSchema,
    comment: z.string().max(1000).optional(),
});

export const caseResolveSchema = z.object({
    resolutionReason: z.string().min(5, 'Resolution reason must be at least 5 characters').max(2000),
    comment: z.string().max(1000).optional(),
});

export const caseDismissSchema = z.object({
    dismissalReason: z.string().min(5, 'Dismissal reason must be at least 5 characters').max(2000),
    comment: z.string().max(1000).optional(),
});

export const caseOverrideSchema = z.object({
    escalationLevel: z.number().int().min(1).max(10).optional(),
    status: z.nativeEnum(EscalationCaseStatus).optional(),
    assignedManager: objectIdSchema.nullable().optional(),
    dueAt: z.string().datetime().optional(),
    reason: z.string().min(5, 'Override reason must be at least 5 characters').max(2000),
});

export const caseExplanationSchema = z.object({
    explanation: z.string().min(5, 'Explanation must be at least 5 characters').max(3000),
});

export const caseCommentSchema = z.object({
    comment: z.string().min(2, 'Comment must be at least 2 characters').max(2000),
});

export const escalationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    category: z.nativeEnum(EscalationCategory).optional(),
    status: z.nativeEnum(EscalationCaseStatus).optional(),
    employeeId: objectIdSchema.optional(),
    assignedManager: objectIdSchema.optional(),
    departmentId: objectIdSchema.optional(),
    severity: z.nativeEnum(EscalationSeverity).optional(),
    level: z.coerce.number().int().min(1).max(10).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['createdAt', 'dueAt', 'escalationLevel', 'occurrenceCount', 'status']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const exportQuerySchema = escalationQuerySchema.extend({
    format: z.enum(['csv', 'excel', 'json']).optional().default('csv'),
});

// ─── Request Wrappers for validateRequest middleware ─────────────────────────
export const createRuleRequestSchema = z.object({
    body: createEscalationRuleSchema,
});

export const updateRuleRequestSchema = z.object({
    body: updateEscalationRuleSchema,
});

export const toggleRuleStatusRequestSchema = z.object({
    body: toggleRuleStatusSchema,
});

export const caseAcknowledgeRequestSchema = z.object({
    body: caseAcknowledgeSchema,
});

export const caseAssignRequestSchema = z.object({
    body: caseAssignSchema,
});

export const caseResolveRequestSchema = z.object({
    body: caseResolveSchema,
});

export const caseDismissRequestSchema = z.object({
    body: caseDismissSchema,
});

export const caseOverrideRequestSchema = z.object({
    body: caseOverrideSchema,
});

export const caseExplanationRequestSchema = z.object({
    body: caseExplanationSchema,
});
