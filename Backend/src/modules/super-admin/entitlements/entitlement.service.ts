import { PlanFeature } from '../plan-features/plan-features.model';
import { Feature } from '../features/features.model';
import { Subscription } from '../subscriptions/subscription.model';
import { SubscriptionStatus } from '../subscriptions/subscription.types';

export class EntitlementService {
    /**
     * Check if a company has access to a specific feature key.
     * Evaluates subscription state, plan entitlement, and feature status.
     */
    static async canAccess(companyId: string, featureKey: string): Promise<boolean> {
        // 1. Get company's active subscription
        const sub = await Subscription.findOne({
            companyId,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        });

        if (!sub) return false;

        // 2. Identify the feature by key
        const feature = await Feature.findOne({ key: featureKey.toUpperCase(), isActive: true });
        if (!feature) return false;

        // 3. Check the plan's entitlement for this feature
        const pf = await PlanFeature.findOne({
            planId: sub.planId,
            featureId: feature._id,
        });

        if (!pf || !pf.enabled) return false;

        return true;
    }

    /**
     * Get the limit rule for a specific feature on a company's plan.
     * Returns the limit value if applicable, or null if unlimited/disabled.
     */
    static async getFeatureLimit(
        companyId: string,
        featureKey: string
    ): Promise<{ enabled: boolean; limitType: 'NONE' | 'LIMITED' | 'UNLIMITED'; value: number | null }> {
        const defaultResponse: Awaited<ReturnType<typeof EntitlementService.getFeatureLimit>> = {
            enabled: false,
            limitType: 'NONE',
            value: null,
        };

        const sub = await Subscription.findOne({
            companyId,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        });

        if (!sub) return defaultResponse;

        const feature = await Feature.findOne({ key: featureKey.toUpperCase(), isActive: true });
        if (!feature) return defaultResponse;

        const pf = await PlanFeature.findOne({ planId: sub.planId, featureId: feature._id });
        if (!pf || !pf.enabled) return defaultResponse;

        return {
            enabled: pf.enabled,
            limitType: pf.limitType as 'NONE' | 'LIMITED' | 'UNLIMITED',
            value: pf.value,
        };
    }
}
