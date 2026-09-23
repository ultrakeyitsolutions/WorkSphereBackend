import { PlanFeature } from '../modules/super-admin/plan-features/plan-features.model';
import { Feature } from '../modules/super-admin/features/features.model';
import { Subscription } from '../modules/super-admin/subscriptions/subscription.model';

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
    private static async getPlanIdForCompany(_companyId: string): Promise<string | null> {
        const sub = await Subscription.findOne({ companyId: _companyId }).sort({ createdAt: -1 }).lean();
        if (sub && (sub.status === 'ACTIVE' || sub.status === 'TRIALING' || sub.status === 'PAUSED' || sub.status === 'PAST_DUE')) {
            return String(sub.planId);
        }
        return null;
    }

    /**
     * Builds possible key variations and aliases for a feature key.
     * Handles:
     * - GOOGLE_MEET <-> GOOGLE MEET <-> GOOGLE-MEET <-> GOOGLEMEET
     * - MS_TEAMS <-> MS TEAMS <-> TEAMS_MEET <-> TEAMS MEET <-> MICROSOFT_TEAMS <-> TEAMS
     * - Generates case-insensitive and whitespace/underscore/dash-insensitive queries.
     */
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
     * Looks up the PlanFeature entitlement for a company's active plan.
     */
    private static async getEntitlement(companyId: string, featureKey: string) {
        const planId = await this.getPlanIdForCompany(companyId);
        if (!planId) return null;

        const keyFilter = this.getFeatureKeyFilter(featureKey);
        const features = await Feature.find({ ...keyFilter, isActive: true }).lean();
        if (!features || features.length === 0) return null;

        const featureIds = features.map((f) => f._id);
        return PlanFeature.findOne({ planId, featureId: { $in: featureIds } }).lean();
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

    /**
     * Resolves Quick Meeting quota and cycle based on PlanFeature or Plan billing cycle.
     * Rules:
     * - MONTHLY plan: 7 meetings per month
     * - SEMI_ANNUAL plan: 60 meetings per month
     * - YEARLY plan: Unlimited meetings (-1)
     * - If explicit PlanFeature is configured for QUICK_MEETINGS, honors its value/UNLIMITED.
     */
    static async getQuickMeetingLimits(companyId: string): Promise<{
        enabled: boolean;
        monthlyLimit: number;
        isUnlimited: boolean;
        billingCycle: string;
        planName: string;
    }> {
        const entitlement = await this.getEntitlement(companyId, 'QUICK_MEETINGS');

        const sub: any = await Subscription.findOne({ companyId })
            .sort({ createdAt: -1 })
            .populate('planId')
            .lean();

        const plan = sub?.planId;
        const billingCycle: string = plan?.billingCycle || (sub ? 'MONTHLY' : 'FREE');
        const planName: string = plan?.name || (sub ? 'Subscription Plan' : 'Free Trial');

        if (entitlement) {
            if (!entitlement.enabled) {
                return {
                    enabled: false,
                    monthlyLimit: 0,
                    isUnlimited: false,
                    billingCycle,
                    planName,
                };
            }
            if (entitlement.limitType === 'UNLIMITED') {
                return {
                    enabled: true,
                    monthlyLimit: -1,
                    isUnlimited: true,
                    billingCycle,
                    planName,
                };
            }
            if (typeof entitlement.value === 'number') {
                return {
                    enabled: true,
                    monthlyLimit: entitlement.value,
                    isUnlimited: false,
                    billingCycle,
                    planName,
                };
            }
        }

        // Standard billingCycle tiered limits:
        if (billingCycle === 'YEARLY') {
            return {
                enabled: true,
                monthlyLimit: -1,
                isUnlimited: true,
                billingCycle,
                planName,
            };
        } else if (billingCycle === 'SEMI_ANNUAL') {
            return {
                enabled: true,
                monthlyLimit: 60,
                isUnlimited: false,
                billingCycle,
                planName,
            };
        } else {
            // MONTHLY or default trial (7 meetings/month)
            return {
                enabled: true,
                monthlyLimit: 7,
                isUnlimited: false,
                billingCycle,
                planName,
            };
        }
    }
}
