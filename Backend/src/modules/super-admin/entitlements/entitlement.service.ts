import { PlanFeature } from '../plan-features/plan-features.model';
import { Feature } from '../features/features.model';
import { Subscription } from '../subscriptions/subscription.model';
import { SubscriptionStatus } from '../subscriptions/subscription.types';

export class EntitlementService {
    private static getFeatureKeyFilter(featureKey: string) {
        const clean = (featureKey || '').trim();
        const upper = clean.toUpperCase();
        const withUnderscores = upper.replace(/[\s-]+/g, '_');
        const withSpaces = upper.replace(/[_\s-]+/g, ' ');
        const withHyphens = upper.replace(/[_\s-]+/g, '-');
        const stripped = upper.replace(/[_\s-]+/g, '');

        const candidates = new Set<string>([
            upper,
            withUnderscores,
            withSpaces,
            withHyphens,
            stripped,
        ]);

        if (upper.includes('GOOGLE') || upper.includes('MEET')) {
            candidates.add('GOOGLE_MEET');
            candidates.add('GOOGLE MEET');
            candidates.add('GOOGLE-MEET');
            candidates.add('GOOGLEMEET');
            candidates.add('GOOGLE_MEET_INTEGRATION');
            candidates.add('GOOGLE MEET INTEGRATION');
        }

        if (upper.includes('TEAM') || upper.includes('MS_TEAMS') || upper.includes('MICROSOFT')) {
            candidates.add('MS_TEAMS');
            candidates.add('MS TEAMS');
            candidates.add('MS-TEAMS');
            candidates.add('TEAMS_MEET');
            candidates.add('TEAMS MEET');
            candidates.add('TEAMS-MEET');
            candidates.add('MICROSOFT_TEAMS');
            candidates.add('MICROSOFT TEAMS');
            candidates.add('TEAMS');
            candidates.add('MICROSOFT_TEAMS_INTEGRATION');
            candidates.add('MICROSOFT TEAMS INTEGRATION');
        }

        if (upper.includes('QUICK')) {
            candidates.add('QUICK_MEETINGS');
            candidates.add('QUICK MEETINGS');
            candidates.add('QUICK_MEETING');
            candidates.add('QUICK MEETING');
        }

        const candidateArray = Array.from(candidates);
        const regexPatterns = candidateArray.map((c) => `^${c.replace(/[_\s-]+/g, '[-_\\s]?')}$`).join('|');

        return {
            $or: [
                { key: { $in: candidateArray } },
                { key: { $regex: new RegExp(`^(${regexPatterns})$`, 'i') } },
            ],
        };
    }

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
        const keyFilter = this.getFeatureKeyFilter(featureKey);
        const feature = await Feature.findOne({ ...keyFilter, isActive: true }).lean();
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

        const keyFilter = this.getFeatureKeyFilter(featureKey);
        const feature = await Feature.findOne({ ...keyFilter, isActive: true }).lean();
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
