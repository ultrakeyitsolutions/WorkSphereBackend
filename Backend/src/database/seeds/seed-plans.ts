import { Plan } from '../../modules/super-admin/plans/plans.model';
import { Feature } from '../../modules/super-admin/features/features.model';
import { PlanFeature } from '../../modules/super-admin/plan-features/plan-features.model';
import { EntitlementService } from '../../services/entitlement.service';

export interface PlanSeedResult {
    plansCreated: number;
    plansUpdated: number;
    entitlementsConfigured: number;
    totalPlans: number;
}

interface PlanConfigDefinition {
    name: string;
    code: string;
    description: string;
    billingCycle: 'MONTHLY' | 'SEMI_ANNUAL' | 'YEARLY';
    price: number;
    currency: string;
    trialPeriodDays: number;
    isActive: boolean;
    isDefault: boolean;
    entitlements: Record<
        string,
        {
            enabled: boolean;
            limitType: 'NONE' | 'LIMITED' | 'UNLIMITED';
            value: number | null;
        }
    >;
}

export const SEED_PLANS: PlanConfigDefinition[] = [
    // ── 1. Starter Plan (Default / Free Tier) ──────────────────────────────────
    {
        name: 'Starter Plan',
        code: 'STARTER',
        description: 'Essential tools for small teams getting started with workspace management',
        billingCycle: 'MONTHLY',
        price: 0,
        currency: 'INR',
        trialPeriodDays: 0,
        isActive: true,
        isDefault: true,
        entitlements: {
            USERS: { enabled: true, limitType: 'LIMITED', value: 5 },
            PROJECTS: { enabled: true, limitType: 'LIMITED', value: 3 },
            TASKS: { enabled: true, limitType: 'LIMITED', value: 50 },
            STORAGE: { enabled: true, limitType: 'LIMITED', value: 5 },
            QUICK_MEETINGS: { enabled: true, limitType: 'LIMITED', value: 7 },
            TASK_MANAGEMENT: { enabled: true, limitType: 'NONE', value: null },
            TASK_TEMPLATES: { enabled: false, limitType: 'NONE', value: null },
            RECURRING_TASKS: { enabled: false, limitType: 'NONE', value: null },
            FILE_ATTACHMENTS: { enabled: true, limitType: 'NONE', value: null },
            TIME_TRACKING: { enabled: true, limitType: 'NONE', value: null },
            BASIC_ANALYTICS: { enabled: true, limitType: 'NONE', value: null },
            ADVANCED_TIME_TRACKING: { enabled: false, limitType: 'NONE', value: null },
            DASHBOARD_ANALYTICS: { enabled: false, limitType: 'NONE', value: null },
            ROLES_PERMISSIONS: { enabled: false, limitType: 'NONE', value: null },
            TASK_WORKFLOWS: { enabled: false, limitType: 'NONE', value: null },
            CHAT: { enabled: true, limitType: 'NONE', value: null },
            GOOGLE_MEET: { enabled: false, limitType: 'NONE', value: null },
            MS_TEAMS: { enabled: false, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_EMAIL: { enabled: false, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_THEME: { enabled: false, limitType: 'NONE', value: null },
            LIVE_MONITORING: { enabled: false, limitType: 'NONE', value: null },
            DETAILED_MONITORING: { enabled: false, limitType: 'NONE', value: null },
        },
    },

    // ── 2. Growth Plan (Mid-tier) ──────────────────────────────────────────────
    {
        name: 'Growth Plan',
        code: 'GROWTH',
        description: 'Advanced productivity, tracking, integrations, and live monitoring for growing teams',
        billingCycle: 'MONTHLY',
        price: 999,
        currency: 'INR',
        trialPeriodDays: 14,
        isActive: true,
        isDefault: false,
        entitlements: {
            USERS: { enabled: true, limitType: 'LIMITED', value: 50 },
            PROJECTS: { enabled: true, limitType: 'LIMITED', value: 25 },
            TASKS: { enabled: true, limitType: 'LIMITED', value: 500 },
            STORAGE: { enabled: true, limitType: 'LIMITED', value: 50 },
            QUICK_MEETINGS: { enabled: true, limitType: 'LIMITED', value: 60 },
            TASK_MANAGEMENT: { enabled: true, limitType: 'NONE', value: null },
            TASK_TEMPLATES: { enabled: true, limitType: 'NONE', value: null },
            RECURRING_TASKS: { enabled: true, limitType: 'NONE', value: null },
            FILE_ATTACHMENTS: { enabled: true, limitType: 'NONE', value: null },
            TIME_TRACKING: { enabled: true, limitType: 'NONE', value: null },
            BASIC_ANALYTICS: { enabled: true, limitType: 'NONE', value: null },
            ADVANCED_TIME_TRACKING: { enabled: true, limitType: 'NONE', value: null },
            DASHBOARD_ANALYTICS: { enabled: true, limitType: 'NONE', value: null },
            ROLES_PERMISSIONS: { enabled: true, limitType: 'NONE', value: null },
            TASK_WORKFLOWS: { enabled: true, limitType: 'NONE', value: null },
            CHAT: { enabled: true, limitType: 'NONE', value: null },
            GOOGLE_MEET: { enabled: true, limitType: 'NONE', value: null },
            MS_TEAMS: { enabled: true, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_EMAIL: { enabled: false, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_THEME: { enabled: true, limitType: 'NONE', value: null },
            LIVE_MONITORING: { enabled: true, limitType: 'NONE', value: null },
            DETAILED_MONITORING: { enabled: false, limitType: 'NONE', value: null },
        },
    },

    // ── 3. Enterprise Plan (High-tier / Annual) ────────────────────────────────
    {
        name: 'Enterprise Plan',
        code: 'ENTERPRISE',
        description: 'Uncapped capacity, dedicated email relay, detailed monitoring, and white-label custom themes',
        billingCycle: 'YEARLY',
        price: 9999,
        currency: 'INR',
        trialPeriodDays: 14,
        isActive: true,
        isDefault: false,
        entitlements: {
            USERS: { enabled: true, limitType: 'UNLIMITED', value: null },
            PROJECTS: { enabled: true, limitType: 'UNLIMITED', value: null },
            TASKS: { enabled: true, limitType: 'UNLIMITED', value: null },
            STORAGE: { enabled: true, limitType: 'LIMITED', value: 500 },
            QUICK_MEETINGS: { enabled: true, limitType: 'UNLIMITED', value: null },
            TASK_MANAGEMENT: { enabled: true, limitType: 'NONE', value: null },
            TASK_TEMPLATES: { enabled: true, limitType: 'NONE', value: null },
            RECURRING_TASKS: { enabled: true, limitType: 'NONE', value: null },
            FILE_ATTACHMENTS: { enabled: true, limitType: 'NONE', value: null },
            TIME_TRACKING: { enabled: true, limitType: 'NONE', value: null },
            BASIC_ANALYTICS: { enabled: true, limitType: 'NONE', value: null },
            ADVANCED_TIME_TRACKING: { enabled: true, limitType: 'NONE', value: null },
            DASHBOARD_ANALYTICS: { enabled: true, limitType: 'NONE', value: null },
            ROLES_PERMISSIONS: { enabled: true, limitType: 'NONE', value: null },
            TASK_WORKFLOWS: { enabled: true, limitType: 'NONE', value: null },
            CHAT: { enabled: true, limitType: 'NONE', value: null },
            GOOGLE_MEET: { enabled: true, limitType: 'NONE', value: null },
            MS_TEAMS: { enabled: true, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_EMAIL: { enabled: true, limitType: 'NONE', value: null },
            CUSTOM_COMPANY_THEME: { enabled: true, limitType: 'NONE', value: null },
            LIVE_MONITORING: { enabled: true, limitType: 'NONE', value: null },
            DETAILED_MONITORING: { enabled: true, limitType: 'NONE', value: null },
        },
    },
];

/**
 * Idempotently seeds subscription plans and their PlanFeature entitlements.
 */
export async function seedPlans(dryRun = false): Promise<PlanSeedResult> {
    const catalogFeatures = await Feature.find({ isActive: true }).lean();
    const featureMap = new Map(catalogFeatures.map((f) => [f.key, f]));

    let plansCreated = 0;
    let plansUpdated = 0;
    let entitlementsConfigured = 0;

    for (const planDef of SEED_PLANS) {
        let planDoc = await Plan.findOne({ code: planDef.code });

        if (!planDoc) {
            if (!dryRun) {
                planDoc = await Plan.create({
                    name: planDef.name,
                    code: planDef.code,
                    description: planDef.description,
                    billingCycle: planDef.billingCycle,
                    price: planDef.price,
                    currency: planDef.currency,
                    trialPeriodDays: planDef.trialPeriodDays,
                    isActive: planDef.isActive,
                    isDefault: planDef.isDefault,
                    isArchived: false,
                });
            }
            plansCreated++;
        } else {
            // Check if active or description needs update (preserve custom pricing in production)
            const needsUpdate = !planDoc.isActive || planDoc.isArchived;
            if (needsUpdate && !dryRun) {
                planDoc.isActive = true;
                planDoc.isArchived = false;
                await planDoc.save();
                plansUpdated++;
            }
        }

        const planId = planDoc?._id;

        // Upsert PlanFeature entitlements for all catalog features
        for (const [featureKey, conf] of Object.entries(planDef.entitlements)) {
            const feat = featureMap.get(featureKey);
            if (!feat) continue;

            if (!dryRun && planId) {
                await PlanFeature.updateOne(
                    { planId, featureId: feat._id },
                    {
                        $set: {
                            enabled: conf.enabled,
                            limitType: conf.limitType,
                            value: conf.value,
                        },
                    },
                    { upsert: true }
                );
            }
            entitlementsConfigured++;
        }
    }

    if (!dryRun) {
        EntitlementService.clearAllCache();
    }

    return {
        plansCreated,
        plansUpdated,
        entitlementsConfigured,
        totalPlans: SEED_PLANS.length,
    };
}
