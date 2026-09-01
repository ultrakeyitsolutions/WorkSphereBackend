import { PlanFeature } from '../modules/super-admin/plan-features/plan-features.model';
import { Feature } from '../modules/super-admin/features/features.model';

/**
 * EntitlementService
 *
 * Central service for checking what a company is allowed to do based on its plan.
 *
 * Usage pattern:
 *   const allowed = await EntitlementService.hasFeature(companyId, 'TASK_TEMPLATES');
 *   const limit   = await EntitlementService.getLimit(companyId, 'USERS');
 *
 * NOTE: Phase 1 — planId is passed directly.
 * NOTE: Phase 2 — replace getPlanIdForCompany() when Subscription model is added.
 */
export class EntitlementService {

    // ─── Internal Helper ──────────────────────────────────────────────────────

    /**
     * Phase 2: Replace this with a real Subscription lookup.
     * e.g. const sub = await Subscription.findOne({ companyId, status: 'ACTIVE' });
     *      return String(sub.planId);
     */
    private static async getPlanIdForCompany(companyId: string): Promise<string | null> {
        // TODO: Implement when Subscription model is available
        // const sub = await Subscription.findOne({ companyId, status: 'ACTIVE' }).lean();
        // return sub ? String(sub.planId) : null;
        return null; // placeholder
    }

    /**
     * Looks up the PlanFeature entitlement for a company's active plan.
     */
    private static async getEntitlement(companyId: string, featureKey: string) {
        const planId = await this.getPlanIdForCompany(companyId);
        if (!planId) return null;

        const feature = await Feature.findOne({ key: featureKey.toUpperCase(), isActive: true }).lean();
        if (!feature) return null;

        return PlanFeature.findOne({ planId, featureId: feature._id }).lean();
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns true if the company's plan has the feature enabled.
     * Works for both BOOLEAN and LIMIT features.
     */
    static async hasFeature(companyId: string, featureKey: string): Promise<boolean> {
        const entitlement = await this.getEntitlement(companyId, featureKey);
        return !!(entitlement?.enabled);
    }

    /**
     * Returns the numeric limit for a LIMIT feature.
     * Returns null if the feature is UNLIMITED.
     * Returns null if the feature doesn't exist or is not enabled.
     */
    static async getLimit(companyId: string, featureKey: string): Promise<number | null> {
        const entitlement = await this.getEntitlement(companyId, featureKey);
        if (!entitlement || !entitlement.enabled) return null;
        if (entitlement.limitType === 'UNLIMITED') return null;
        return entitlement.value;
    }

    /**
     * Returns true if the company has UNLIMITED access to a LIMIT feature.
     */
    static async isUnlimited(companyId: string, featureKey: string): Promise<boolean> {
        const entitlement = await this.getEntitlement(companyId, featureKey);
        return entitlement?.limitType === 'UNLIMITED';
    }

    /**
     * Returns true if the company is within its plan limit for a feature.
     *
     * Usage:
     *   const canAdd = await EntitlementService.checkLimit(companyId, 'USERS', currentUserCount);
     *   if (!canAdd) return sendError(res, 'USER_LIMIT_REACHED', 403);
     */
    static async checkLimit(
        companyId: string,
        featureKey: string,
        currentUsage: number
    ): Promise<boolean> {
        const entitlement = await this.getEntitlement(companyId, featureKey);

        if (!entitlement || !entitlement.enabled) return false;
        if (entitlement.limitType === 'UNLIMITED') return true;
        if (entitlement.limitType === 'NONE') return true;  // boolean feature, no cap

        return currentUsage < (entitlement.value ?? 0);
    }

    /**
     * Returns the full entitlement details for a feature key.
     * Useful for building error messages.
     */
    static async getEntitlementDetails(companyId: string, featureKey: string) {
        const entitlement = await this.getEntitlement(companyId, featureKey);
        if (!entitlement) return null;

        return {
            enabled: entitlement.enabled,
            limitType: entitlement.limitType,
            value: entitlement.value,
        };
    }
}
