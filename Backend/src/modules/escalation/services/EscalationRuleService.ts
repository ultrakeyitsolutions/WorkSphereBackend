import { Types } from 'mongoose';
import { EscalationRule } from '../models/EscalationRule';
import {
    EscalationCategory,
    EscalationSeverity,
    EscalationResetPeriod,
    DEFAULT_ESCALATION_LEVELS,
    EscalationAuditAction,
} from '../constants/escalation.constants';
import { EscalationAuditService } from './EscalationAuditService';
import { AppError } from '../../../utils/AppError';

export interface DefaultRuleConfig {
    ruleName: string;
    category: EscalationCategory;
    description: string;
    severity: EscalationSeverity;
    gracePeriod: number;
    thresholds: Record<string, any>;
    escalationLevels: typeof DEFAULT_ESCALATION_LEVELS;
    resetPeriod: EscalationResetPeriod;
    resolutionDeadline: number;
}

export const SYSTEM_DEFAULT_RULES: DefaultRuleConfig[] = [
    {
        ruleName: 'Default Late Check-in Compliance Rule',
        category: EscalationCategory.LATE_CHECK_IN,
        description: 'Monitors employee check-in times past assigned shift start time with grace period.',
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 15, // 15 mins
        thresholds: {
            occurrenceThreshold: 1, // 1st = emp, 2nd = manager, 3rd = admin, 4th = executive
            maxViolationDuration: 120,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 48,
    },
    {
        ruleName: 'Default Break Time Compliance Rule',
        category: EscalationCategory.BREAK_TIME_EXCEEDED,
        description: 'Monitors excessive break durations compared against shift break limits.',
        severity: EscalationSeverity.LOW,
        gracePeriod: 10,
        thresholds: {
            breakDurationLimitMinutes: 60,
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 48,
    },
    {
        ruleName: 'Default Inactivity & Idle Time Rule',
        category: EscalationCategory.IDLE_TIME_EXCEEDED,
        description: 'Detects prolonged inactivity during active check-in while excluding breaks and network sleep.',
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 0,
        thresholds: {
            idleThresholdMinutes: 45,
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.WEEKLY,
        resolutionDeadline: 48,
    },
    {
        ruleName: 'Default Reopened Task Rule',
        category: EscalationCategory.REOPENED_TASK,
        description: 'Monitors tasks reopened after marked as completed or cancelled.',
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 0,
        thresholds: {
            reopenCountThreshold: 2,
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 72,
    },
    {
        ruleName: 'Default Project Delay & Inefficiency Rule',
        category: EscalationCategory.WORK_INEFFICIENCY_DELAY,
        description: 'Monitors repeated overdue tasks and milestone delays for verified team review.',
        severity: EscalationSeverity.HIGH,
        gracePeriod: 0,
        thresholds: {
            projectDelayDays: 3,
            occurrenceThreshold: 2,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 96,
    },
    {
        ruleName: 'Default Production Hours Discrepancy Rule',
        category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
        description: 'Identifies missing check-outs, severe undertime, or shift discrepancies.',
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 30,
        thresholds: {
            maxViolationDuration: 180,
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 48,
    },
    {
        ruleName: 'Default Biometric Compliance Rule',
        category: EscalationCategory.BIOMETRIC_COMPLIANCE,
        description: 'Identifies biometric verification mismatches when biometric authentication is enabled.',
        severity: EscalationSeverity.HIGH,
        gracePeriod: 0,
        thresholds: {
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 24,
    },
    {
        ruleName: 'Default Custom Policy Rule',
        category: EscalationCategory.CUSTOM_POLICY,
        description: 'Handles custom compliance events including unapproved absences and missed meetings.',
        severity: EscalationSeverity.MEDIUM,
        gracePeriod: 0,
        thresholds: {
            occurrenceThreshold: 1,
        },
        escalationLevels: DEFAULT_ESCALATION_LEVELS,
        resetPeriod: EscalationResetPeriod.MONTHLY,
        resolutionDeadline: 48,
    },
];

export class EscalationRuleService {
    /**
     * Retrieves the active rule for a company and category.
     * If no rule is found, auto-provisions the system default rule for that company.
     */
    public static async getActiveRule(companyId: string, category: EscalationCategory) {
        const companyObjId = new Types.ObjectId(companyId);

        let rule = await EscalationRule.findOne({
            companyId: companyObjId,
            category,
            isEnabled: true,
        }).lean();

        if (!rule) {
            // Check if any rule exists (even disabled)
            const existingAny = await EscalationRule.findOne({
                companyId: companyObjId,
                category,
            }).lean();

            if (!existingAny) {
                // Auto-provision standard default for this category
                const defaultDef = SYSTEM_DEFAULT_RULES.find((r) => r.category === category);
                if (defaultDef) {
                    const created = await EscalationRule.create({
                        companyId: companyObjId,
                        ...defaultDef,
                        isEnabled: true,
                    });
                    rule = created.toObject();
                }
            }
        }

        return rule;
    }

    /**
     * Seeds all default rules for a newly initialized company.
     */
    public static async seedDefaultRules(companyId: string, actorId?: string) {
        const companyObjId = new Types.ObjectId(companyId);
        const results: any[] = [];

        for (const defaultRule of SYSTEM_DEFAULT_RULES) {
            const exists = await EscalationRule.findOne({
                companyId: companyObjId,
                category: defaultRule.category,
            });

            if (!exists) {
                const created = await EscalationRule.create({
                    companyId: companyObjId,
                    ...defaultRule,
                    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
                });
                results.push(created);
            }
        }

        return results;
    }

    /**
     * List rules for a company with pagination and filters.
     */
    public static async listRules(companyId: string, filter: { category?: string; isEnabled?: boolean }) {
        const query: any = { companyId: new Types.ObjectId(companyId) };
        if (filter.category) query.category = filter.category;
        if (typeof filter.isEnabled === 'boolean') query.isEnabled = filter.isEnabled;

        // If company has no rules at all, auto seed
        const count = await EscalationRule.countDocuments({ companyId: new Types.ObjectId(companyId) });
        if (count === 0) {
            await this.seedDefaultRules(companyId);
        }

        return EscalationRule.find(query)
            .sort({ category: 1, createdAt: -1 })
            .lean();
    }

    /**
     * Get rule by ID with tenant isolation.
     */
    public static async getRuleById(companyId: string, ruleId: string) {
        const rule = await EscalationRule.findOne({
            _id: new Types.ObjectId(ruleId),
            companyId: new Types.ObjectId(companyId),
        }).lean();

        if (!rule) {
            throw AppError.notFound('Escalation rule not found');
        }
        return rule;
    }

    /**
     * Create a new custom or modified escalation rule.
     */
    public static async createRule(companyId: string, data: any, actorId: string) {
        const companyObjId = new Types.ObjectId(companyId);

        // Check if rule name already exists in this company
        const duplicate = await EscalationRule.findOne({
            companyId: companyObjId,
            ruleName: data.ruleName,
        });
        if (duplicate) {
            throw AppError.conflict('An escalation rule with this name already exists in your organization');
        }

        const rule = await EscalationRule.create({
            ...data,
            companyId: companyObjId,
            createdBy: new Types.ObjectId(actorId),
            updatedBy: new Types.ObjectId(actorId),
        });

        await EscalationAuditService.log({
            companyId,
            ruleId: rule._id,
            actorId,
            action: EscalationAuditAction.RULE_CREATED,
            newValue: rule.toObject(),
            reason: `Created escalation rule ${rule.ruleName}`,
        });

        return rule;
    }

    /**
     * Update an existing escalation rule.
     */
    public static async updateRule(companyId: string, ruleId: string, data: any, actorId: string) {
        const companyObjId = new Types.ObjectId(companyId);
        const rule = await EscalationRule.findOne({
            _id: new Types.ObjectId(ruleId),
            companyId: companyObjId,
        });

        if (!rule) {
            throw AppError.notFound('Escalation rule not found');
        }

        const previousValue = rule.toObject();

        if (data.ruleName && data.ruleName !== rule.ruleName) {
            const duplicate = await EscalationRule.findOne({
                companyId: companyObjId,
                ruleName: data.ruleName,
                _id: { $ne: rule._id },
            });
            if (duplicate) {
                throw AppError.conflict('Another rule with this name already exists');
            }
        }

        Object.assign(rule, data, {
            updatedBy: new Types.ObjectId(actorId),
        });

        await rule.save();

        await EscalationAuditService.log({
            companyId,
            ruleId: rule._id,
            actorId,
            action: EscalationAuditAction.RULE_UPDATED,
            previousValue,
            newValue: rule.toObject(),
            reason: `Updated escalation rule ${rule.ruleName}`,
        });

        return rule;
    }

    /**
     * Toggle active/inactive status of a rule.
     */
    public static async toggleRuleStatus(companyId: string, ruleId: string, isEnabled: boolean, actorId: string) {
        const rule = await EscalationRule.findOne({
            _id: new Types.ObjectId(ruleId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!rule) {
            throw AppError.notFound('Escalation rule not found');
        }

        const previousStatus = rule.isEnabled;
        rule.isEnabled = isEnabled;
        rule.updatedBy = new Types.ObjectId(actorId);
        await rule.save();

        await EscalationAuditService.log({
            companyId,
            ruleId: rule._id,
            actorId,
            action: EscalationAuditAction.RULE_STATUS_TOGGLED,
            previousValue: { isEnabled: previousStatus },
            newValue: { isEnabled },
            reason: `Toggled rule status to ${isEnabled ? 'enabled' : 'disabled'}`,
        });

        return rule;
    }
}
export default EscalationRuleService;
