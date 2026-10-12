import { Types } from 'mongoose';
import { Plan } from '../plans/plans.model';
import { Feature } from '../features/features.model';
import { PlanFeature } from '../plan-features/plan-features.model';
import { Subscription } from '../subscriptions/subscription.model';
import { SubscriptionStatus } from '../subscriptions/subscription.types';
import { Company } from '../companies/company.model';
import { EntitlementService } from '../../../services/entitlement.service';

export interface PlanAuditSummary {
    planId: string;
    planName: string;
    billingCycle: string;
    isActive: boolean;
    configuredFeaturesCount: number;
    missingCatalogFeatures: string[];
}

export interface CompanyEntitlementDiff {
    companyId: string;
    companyName: string;
    subscriptionStatus: SubscriptionStatus | 'NONE';
    currentPeriodEnd?: Date | null;
    planName: string;
    planBillingCycle: string;
    featuresLost: string[];
    featuresGained: string[];
    unconfiguredPlan: boolean;
}

export interface ReconciliationReport {
    timestamp: string;
    isDryRun: boolean;
    plansAudited: number;
    companiesAudited: number;
    plansWithMissingFeatures: PlanAuditSummary[];
    companiesWithDiscrepancies: CompanyEntitlementDiff[];
    reconciledCount: number;
}

export class EntitlementReconciliationService {
    /**
     * Run an audit and optional safe reconciliation across all plans, features, and company subscriptions.
     * @param dryRun If true, produces diff report without applying database mutations.
     */
    static async runReconciliation(dryRun: boolean = true): Promise<ReconciliationReport> {
        const catalogFeatures = await Feature.find({ isActive: true }).lean();
        const catalogFeatureKeys = catalogFeatures.map((f) => f.key);
        const catalogFeatureMap = new Map(catalogFeatures.map((f) => [f.key, f]));

        const plans = await Plan.find({}).lean();
        const companies = await Company.find({}).lean();

        const planSummaries: PlanAuditSummary[] = [];

        // 1. Audit Plans against Active Feature Catalog
        for (const plan of plans) {
            const planFeatures = await PlanFeature.find({ planId: plan._id }).lean();
            const configuredFeatureIdSet = new Set(planFeatures.map((pf) => String(pf.featureId)));

            const missingKeys: string[] = [];
            for (const feature of catalogFeatures) {
                if (!configuredFeatureIdSet.has(String(feature._id))) {
                    missingKeys.push(feature.key);
                }
            }

            if (missingKeys.length > 0) {
                planSummaries.push({
                    planId: String(plan._id),
                    planName: plan.name,
                    billingCycle: plan.billingCycle,
                    isActive: plan.isActive,
                    configuredFeaturesCount: planFeatures.length,
                    missingCatalogFeatures: missingKeys,
                });
            }
        }

        // 2. Audit Companies & Subscriptions
        const companyDiscrepancies: CompanyEntitlementDiff[] = [];
        let reconciledCount = 0;

        for (const company of companies) {
            const companyIdStr = String(company._id);
            const sub = await Subscription.findOne({ companyId: company._id })
                .sort({ createdAt: -1 })
                .populate('planId')
                .lean();

            const plan = (sub?.planId as any) || null;
            const subStatus: SubscriptionStatus | 'NONE' = sub?.status || 'NONE';
            const isSubValid =
                (subStatus === SubscriptionStatus.ACTIVE || subStatus === SubscriptionStatus.TRIALING) &&
                (!sub?.currentPeriodEnd || new Date(sub.currentPeriodEnd) > new Date());

            const effectiveEntitlements = await EntitlementService.getEffectiveEntitlements(companyIdStr);

            const lostFeatures: string[] = [];
            const gainedFeatures: string[] = [];

            if (!isSubValid) {
                // If subscription is not valid, all premium features should be inactive
                for (const [key, details] of Object.entries(effectiveEntitlements.features)) {
                    if (details.enabled) {
                        lostFeatures.push(key);
                    }
                }
            } else if (plan) {
                // Subscription is valid: compare effective entitlements against catalog
                for (const key of catalogFeatureKeys) {
                    const isEnabled = effectiveEntitlements.features[key]?.enabled ?? false;
                    const planFeatureDoc = await PlanFeature.findOne({
                        planId: plan._id,
                        featureId: catalogFeatureMap.get(key)?._id,
                    }).lean();

                    const planExplicitlyEnabled = Boolean(planFeatureDoc?.enabled);

                    if (isEnabled && !planExplicitlyEnabled) {
                        lostFeatures.push(key);
                    } else if (!isEnabled && planExplicitlyEnabled) {
                        gainedFeatures.push(key);
                    }
                }
            }

            const unconfiguredPlan =
                Boolean(plan) &&
                planSummaries.some((ps) => ps.planId === String(plan._id) && ps.configuredFeaturesCount === 0);

            if (lostFeatures.length > 0 || gainedFeatures.length > 0 || unconfiguredPlan) {
                companyDiscrepancies.push({
                    companyId: companyIdStr,
                    companyName: company.name,
                    subscriptionStatus: subStatus,
                    currentPeriodEnd: sub?.currentPeriodEnd || null,
                    planName: plan?.name || 'No Plan',
                    planBillingCycle: plan?.billingCycle || 'NONE',
                    featuresLost: lostFeatures,
                    featuresGained: gainedFeatures,
                    unconfiguredPlan,
                });
            }
        }

        // 3. If NOT dryRun: backfill missing default PlanFeatures for unconfigured plans
        if (!dryRun) {
            for (const planSummary of planSummaries) {
                const planId = new Types.ObjectId(planSummary.planId);
                const toInsert: any[] = [];

                for (const missingKey of planSummary.missingCatalogFeatures) {
                    const featureDoc = catalogFeatureMap.get(missingKey);
                    if (!featureDoc) continue;

                    // Safe fail-closed default: disable missing features unless plan is high-tier
                    toInsert.push({
                        planId,
                        featureId: featureDoc._id,
                        enabled: false,
                        limitType: featureDoc.type === 'LIMIT' ? 'LIMITED' : 'NONE',
                        value: null,
                    });
                }

                if (toInsert.length > 0) {
                    await PlanFeature.insertMany(toInsert);
                    reconciledCount += toInsert.length;
                }
            }

            // Invalidate caches across instances
            EntitlementService.clearAllCache();
        }

        return {
            timestamp: new Date().toISOString(),
            isDryRun: dryRun,
            plansAudited: plans.length,
            companiesAudited: companies.length,
            plansWithMissingFeatures: planSummaries,
            companiesWithDiscrepancies: companyDiscrepancies,
            reconciledCount,
        };
    }
}
