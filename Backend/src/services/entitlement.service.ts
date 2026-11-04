import { PlanFeature } from '../modules/super-admin/plan-features/plan-features.model';
import { Feature } from '../modules/super-admin/features/features.model';
import { Subscription } from '../modules/super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../modules/super-admin/subscriptions/subscription.types';
import { getRedisClient } from '../config/redis';
import { FeatureAccessService } from '../modules/companyadmin/settings/feature-access.service';

/**
 * EntitlementService
 *
 * Central authoritative service for resolving, checking, and enforcing
 * company plan feature entitlements, quotas, and limits.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs = 250, fallback: T): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
};

export interface EffectiveFeatureEntitlement {
    key: string;
    name: string;
    category: string;
    type: 'BOOLEAN' | 'LIMIT';
    unit: string;
    enabled: boolean;
    limitType: 'NONE' | 'LIMITED' | 'UNLIMITED';
    value: number | null;
    isExplicitlyGranted: boolean;
    source: 'PLAN' | 'OVERRIDE' | 'DEFAULT' | 'SUBSCRIPTION_INACTIVE';
}

export interface EffectiveSubscriptionInfo {
    id: string;
    status: string;
    planId: string;
    planName: string;
    billingCycle: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
}

export interface EffectiveEntitlementsResponse {
    companyId: string;
    subscription: EffectiveSubscriptionInfo | null;
    features: Record<string, EffectiveFeatureEntitlement>;
}

interface FeatureCacheEntry {
    hasFeature: boolean;
    cachedAt: number;
}

interface EntitlementsCacheEntry {
    data: EffectiveEntitlementsResponse;
    cachedAt: number;
}

const featureCache = new Map<string, FeatureCacheEntry>();
const effectiveEntitlementsCache = new Map<string, EntitlementsCacheEntry>();
const CACHE_TTL_MS = 30 * 1000;
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3-day grace period for renewals and UTC timing skew

export const ENTITLEMENT_INVALIDATION_REDIS_CHANNEL = 'worksphere:entitlements_invalidated';

export class EntitlementService {
    private static isSubscriberInit = false;

    // ─── Redis Cross-Instance Synchronization ─────────────────────────────────

    public static initRedisSubscriber(): void {
        if (this.isSubscriberInit) return;
        try {
            const redis = getRedisClient();
            if (!redis) return;
            const sub = redis.duplicate();
            sub.subscribe(ENTITLEMENT_INVALIDATION_REDIS_CHANNEL, (err) => {
                if (!err) {
                    this.isSubscriberInit = true;
                }
            });
            sub.on('message', (channel, message) => {
                if (channel === ENTITLEMENT_INVALIDATION_REDIS_CHANNEL) {
                    try {
                        const parsed = JSON.parse(message);
                        EntitlementService.evictLocalCache(parsed?.companyId || undefined);
                    } catch {
                        EntitlementService.evictLocalCache();
                    }
                }
            });
        } catch {
            // Redis error fallback
        }
    }

    private static evictLocalCache(companyId?: string): void {
        if (!companyId) {
            featureCache.clear();
            effectiveEntitlementsCache.clear();
            FeatureAccessService.clearAllCache();
            return;
        }
        const norm = String(companyId);
        effectiveEntitlementsCache.delete(norm);
        FeatureAccessService.invalidateCache(norm);
        const prefix = `${norm}:`;
        for (const key of featureCache.keys()) {
            if (key.startsWith(prefix)) {
                featureCache.delete(key);
            }
        }
    }

    // ─── Cache Management ─────────────────────────────────────────────────────

    static invalidateCache(companyId?: string): void {
        this.evictLocalCache(companyId);

        try {
            const redis = getRedisClient();
            if (redis) {
                if (companyId) {
                    redis.keys(`worksphere:cache:module_access:${companyId}:*`).then((keys) => {
                        if (keys && keys.length > 0) {
                            redis.del(...keys).catch(() => {});
                        }
                    }).catch(() => {});
                }
                redis.publish(
                    ENTITLEMENT_INVALIDATION_REDIS_CHANNEL,
                    JSON.stringify({
                        companyId: companyId ? String(companyId) : null,
                        timestamp: Date.now(),
                    })
                ).catch(() => {});
            }
        } catch {
            // Redis fallback
        }
    }

    static clearAllCache(): void {
        this.invalidateCache();
    }

    // ─── Internal Helper ──────────────────────────────────────────────────────

    /**
     * Resolves active or trialing plan ID for the given company.
     * Supports yearly plans with UTC timestamps and grace period.
     */
    private static async getPlanIdForCompany(_companyId: string): Promise<string | null> {
        try {
            if (!_companyId) return null;
            // Search first for an active, trialing, or past_due subscription with latest period end
            let sub: any = await withTimeout(
                Promise.resolve(
                    Subscription.findOne({
                        companyId: _companyId,
                        status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
                    })
                        .sort({ currentPeriodEnd: -1, createdAt: -1 })
                        .lean()
                ),
                3000,
                null
            );

            if (!sub) {
                sub = await withTimeout(
                    Promise.resolve(Subscription.findOne({ companyId: _companyId }).sort({ createdAt: -1 }).lean()),
                    3000,
                    null
                );
            }

            if (sub) {
                const nowMs = Date.now();
                const periodEndMs = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : Infinity;
                const isNotExpired = !sub.currentPeriodEnd || (periodEndMs + GRACE_PERIOD_MS) >= nowMs;
                const isValidStatus = sub.status === 'ACTIVE' || sub.status === 'TRIALING' || (sub.status === 'PAST_DUE' && isNotExpired);

                if (isValidStatus && isNotExpired) {
                    // If scheduled plan transition has arrived, return scheduledPlanId and trigger durable rollover
                    if (sub.scheduledPlanId && sub.currentPeriodEnd && nowMs >= new Date(sub.currentPeriodEnd).getTime()) {
                        const scheduledId = sub.scheduledPlanId?._id || sub.scheduledPlanId;
                        Subscription.updateOne(
                            { _id: sub._id, scheduledPlanId: { $ne: null } },
                            {
                                $set: {
                                    planId: scheduledId,
                                    currentPeriodStart: sub.currentPeriodEnd,
                                },
                                $unset: { scheduledPlanId: 1 },
                            }
                        ).catch(() => {});
                        return String(scheduledId);
                    }

                    const planId = sub.planId?._id || sub.planId;
                    return String(planId);
                }
            }
        } catch {
            return null;
        }
        return null;
    }

    /**
     * Builds possible key variations and aliases for a feature key.
     */
    public static getFeatureKeyFilter(featureKey: string) {
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

        if (
            upper.includes('EMAIL') ||
            upper.includes('CUSTOM_COMPANY_EMAIL') ||
            upper.includes('CUSTOM_EMAIL') ||
            upper.includes('INVITATION') ||
            upper.includes('INVITAION')
        ) {
            candidates.add('CUSTOM_COMPANY_EMAIL');
            candidates.add('CUSTOM COMPANY EMAIL');
            candidates.add('CUSTOM-COMPANY-EMAIL');
            candidates.add('CUSTOM_EMAIL');
            candidates.add('CUSTOM EMAIL');
            candidates.add('CUSTOM_EMAIL_SENDER');
            candidates.add('CUSTOM COMPANY EMAIL SENDER');
            candidates.add('INVITATION EMAIL');
            candidates.add('INVITATION_EMAIL');
            candidates.add('INVITAION EMAIL');
            candidates.add('INVITAION_EMAIL');
            candidates.add('COMPANY_EMAIL');
            candidates.add('COMPANY EMAIL');
        }

        if (upper.includes('LIVE') && upper.includes('MONITOR')) {
            candidates.add('LIVE_MONITORING');
            candidates.add('LIVE MONITORING');
            candidates.add('LIVEMONITORING');
        }

        if (upper.includes('DETAILED') && upper.includes('MONITOR')) {
            candidates.add('DETAILED_MONITORING');
            candidates.add('DETAILED MONITORING');
            candidates.add('DETAILEDMONITORING');
        }

        if (upper.includes('THEME') || upper.includes('BRANDING')) {
            candidates.add('CUSTOM_COMPANY_THEME');
            candidates.add('CUSTOM COMPANY THEME');
            candidates.add('CUSTOM_THEME');
            candidates.add('CUSTOM THEME');
            candidates.add('CUSTOM_BRANDING');
            candidates.add('CUSTOM BRANDING');
        }

        if (upper.includes('REVIEW')) {
            candidates.add('USER_REVIEW_LINKS');
            candidates.add('USER REVIEW LINKS');
            candidates.add('USER_REVIEW');
            candidates.add('USER REVIEW');
        }

        if (upper.includes('USER') || upper.includes('MEMBER') || upper.includes('EMPLOYEE') || upper.includes('SEAT')) {
            candidates.add('USERS');
            candidates.add('MAX_USERS');
            candidates.add('MAX USERS');
            candidates.add('USER_LIMIT');
            candidates.add('USER LIMIT');
            candidates.add('EMPLOYEES');
            candidates.add('MAX_EMPLOYEES');
            candidates.add('SEATS');
        }

        if (upper.includes('PROJECT')) {
            candidates.add('PROJECTS');
            candidates.add('MAX_PROJECTS');
            candidates.add('MAX PROJECTS');
            candidates.add('PROJECT_LIMIT');
            candidates.add('PROJECT LIMIT');
            candidates.add('ACTIVE_PROJECTS');
        }

        if (upper.includes('TASK')) {
            candidates.add('TASKS');
            candidates.add('MAX_TASKS');
            candidates.add('MAX TASKS');
            candidates.add('TASK_LIMIT');
            candidates.add('TASK LIMIT');
            candidates.add('TASKS_PER_PROJECT');
        }

        if (upper.includes('STORAGE') || upper.includes('DISK') || upper.includes('FILE_STORAGE')) {
            candidates.add('STORAGE');
            candidates.add('MAX_STORAGE');
            candidates.add('MAX STORAGE');
            candidates.add('STORAGE_LIMIT');
            candidates.add('STORAGE LIMIT');
            candidates.add('STORAGE_GB');
            candidates.add('STORAGE_LIMIT_GB');
            candidates.add('MAX_STORAGE_GB');
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
        const feature: any = await Feature.findOne({ ...keyFilter, isActive: true }).lean();
        if (!feature) return null;

        return PlanFeature.findOne({ planId, featureId: feature._id }).lean();
    }

    // ─── Authoritative Source of Truth ────────────────────────────────────────

    /**
     * Resolves all effective entitlements for a company.
     * Evaluates subscription validity, expiration date with grace period, assigned plan, and configured PlanFeature records.
     * Fail-closed: unconfigured or missing features are strictly enabled: false.
     */
    static async getEffectiveEntitlements(companyId: string): Promise<EffectiveEntitlementsResponse> {
        const normalizedCompanyId = String(companyId);
        const cached = effectiveEntitlementsCache.get(normalizedCompanyId);
        const now = Date.now();
        if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
            return cached.data;
        }

        const defaultResult: EffectiveEntitlementsResponse = {
            companyId: normalizedCompanyId,
            subscription: null,
            features: {},
        };

        try {
            // Find valid active or past_due subscription prioritizing latest period end
            let sub: any = await withTimeout(
                Promise.resolve(
                    Subscription.findOne({
                        companyId: normalizedCompanyId,
                        status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
                    })
                        .sort({ currentPeriodEnd: -1, createdAt: -1 })
                        .populate('planId')
                        .populate('scheduledPlanId')
                        .lean()
                ),
                3000,
                null
            );

            if (!sub) {
                sub = await withTimeout(
                    Promise.resolve(
                        Subscription.findOne({ companyId: normalizedCompanyId })
                            .sort({ createdAt: -1 })
                            .populate('planId')
                            .populate('scheduledPlanId')
                            .lean()
                    ),
                    3000,
                    null
                );
            }

            const allFeatures: any[] = (await Feature.find({ isActive: true }).lean()) || [];

            const nowMs = Date.now();
            const periodEndMs = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : Infinity;
            const isNotExpired = !sub?.currentPeriodEnd || (periodEndMs + GRACE_PERIOD_MS) >= nowMs;
            const isActiveStatus = sub && (sub.status === 'ACTIVE' || sub.status === 'TRIALING' || (sub.status === 'PAST_DUE' && isNotExpired));

            if (!sub || !isActiveStatus || !isNotExpired) {
                // Inactive, expired, or non-existent subscription
                const inactiveFeatures: Record<string, EffectiveFeatureEntitlement> = {};
                for (const f of allFeatures) {
                    inactiveFeatures[f.key] = {
                        key: f.key,
                        name: f.name,
                        category: f.category,
                        type: f.type,
                        unit: f.unit,
                        enabled: false,
                        limitType: 'NONE',
                        value: null,
                        isExplicitlyGranted: false,
                        source: 'SUBSCRIPTION_INACTIVE',
                    };
                }

                const result: EffectiveEntitlementsResponse = {
                    companyId: normalizedCompanyId,
                    subscription: sub
                        ? {
                              id: String(sub._id),
                              status: sub.status,
                              planId: String(sub.planId?._id || sub.planId || ''),
                              planName: sub.planId?.name || 'Unknown Plan',
                              billingCycle: sub.planId?.billingCycle || 'NONE',
                              currentPeriodStart: sub.currentPeriodStart,
                              currentPeriodEnd: sub.currentPeriodEnd,
                              cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
                          }
                        : null,
                    features: inactiveFeatures,
                };

                effectiveEntitlementsCache.set(normalizedCompanyId, { data: result, cachedAt: now });
                return result;
            }

            // Subscription is ACTIVE and VALID
            let effectivePlan = sub.planId;
            if (sub.scheduledPlanId && sub.currentPeriodEnd && nowMs >= new Date(sub.currentPeriodEnd).getTime()) {
                effectivePlan = sub.scheduledPlanId;
            }

            const effectivePlanId = effectivePlan?._id || effectivePlan;
            const planFeatures: any[] = (await PlanFeature.find({ planId: effectivePlanId }).lean()) || [];
            const pfMap = new Map<string, any>();
            for (const pf of planFeatures) {
                pfMap.set(String(pf.featureId), pf);
            }

            const featureEntitlements: Record<string, EffectiveFeatureEntitlement> = {};
            for (const f of allFeatures) {
                const pf = pfMap.get(String(f._id));
                if (pf && pf.enabled) {
                    featureEntitlements[f.key] = {
                        key: f.key,
                        name: f.name,
                        category: f.category,
                        type: f.type,
                        unit: f.unit,
                        enabled: true,
                        limitType: pf.limitType || (f.type === 'LIMIT' ? 'LIMITED' : 'NONE'),
                        value: pf.value ?? null,
                        isExplicitlyGranted: true,
                        source: 'PLAN',
                    };
                } else {
                    // Fail closed: not included in plan or explicitly disabled
                    featureEntitlements[f.key] = {
                        key: f.key,
                        name: f.name,
                        category: f.category,
                        type: f.type,
                        unit: f.unit,
                        enabled: false,
                        limitType: 'NONE',
                        value: null,
                        isExplicitlyGranted: false,
                        source: 'PLAN',
                    };
                }
            }

            const result: EffectiveEntitlementsResponse = {
                companyId: normalizedCompanyId,
                subscription: {
                    id: String(sub._id),
                    status: sub.status,
                    planId: String(effectivePlanId),
                    planName: effectivePlan?.name || 'Subscription Plan',
                    billingCycle: effectivePlan?.billingCycle || 'NONE',
                    currentPeriodStart: sub.currentPeriodStart,
                    currentPeriodEnd: sub.currentPeriodEnd,
                    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
                },
                features: featureEntitlements,
            };

            effectiveEntitlementsCache.set(normalizedCompanyId, { data: result, cachedAt: now });
            return result;
        } catch {
            return defaultResult;
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns true if the company's effective plan has the feature enabled.
     * Fails closed: unconfigured or missing features return false.
     */
    static async hasFeature(companyId: string, featureKey: string): Promise<boolean> {
        if (!companyId || !featureKey) return false;
        const cacheKey = `${String(companyId)}:${featureKey.trim().toUpperCase()}`;
        const cached = featureCache.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
            return cached.hasFeature;
        }

        let result = false;

        try {
            const effective = await this.getEffectiveEntitlements(companyId);
            if (effective && effective.subscription) {
                const clean = featureKey.trim().toUpperCase();
                if (effective.features[clean]) {
                    result = effective.features[clean].enabled;
                } else {
                    // Alias match
                    const filter = this.getFeatureKeyFilter(featureKey);
                    const candidates = (filter.$or[0] as any)?.key?.$in as string[];
                    for (const [k, f] of Object.entries(effective.features)) {
                        if (candidates && (candidates.includes(k) || candidates.includes(k.replace(/_/g, ' ')))) {
                            if (f.enabled) {
                                result = true;
                                break;
                            }
                        }
                    }
                }
            }
        } catch {
            result = false;
        }

        // Direct fallback to PlanFeature lookup for tests and legacy models
        if (!result) {
            try {
                const entitlement = await this.getEntitlement(companyId, featureKey);
                result = Boolean(entitlement?.enabled);
            } catch {
                result = false;
            }
        }

        featureCache.set(cacheKey, { hasFeature: result, cachedAt: now });
        return result;
    }

    /**
     * Alias for hasFeature to support standard permission/canAccess checks.
     */
    static async canAccess(companyId: string, featureKey: string): Promise<boolean> {
        return this.hasFeature(companyId, featureKey);
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
        return Boolean(entitlement && entitlement.enabled && entitlement.limitType === 'UNLIMITED');
    }

    /**
     * Returns true if the company is within its plan limit for a feature.
     */
    static async checkLimit(
        companyId: string,
        featureKey: string,
        currentUsage: number
    ): Promise<boolean> {
        const entitlement = await this.getEntitlement(companyId, featureKey);

        if (!entitlement || !entitlement.enabled) return false;
        if (entitlement.limitType === 'UNLIMITED') return true;
        return currentUsage < (entitlement.value ?? 0);
    }

    /**
     * Returns the full entitlement details for a feature key.
     * Guaranteed non-null return with enabled: false when feature is absent or disabled.
     */
    static async getEntitlementDetails(companyId: string, featureKey: string): Promise<{
        enabled: boolean;
        limitType: 'NONE' | 'LIMITED' | 'UNLIMITED';
        value: number | null;
        unit?: string;
        key?: string;
        name?: string;
        hasActiveSubscription?: boolean;
        featureFound?: boolean;
    }> {
        const planId = await this.getPlanIdForCompany(companyId);
        if (!planId) {
            return {
                enabled: false,
                limitType: 'NONE' as const,
                value: null,
                hasActiveSubscription: false,
                featureFound: false,
            };
        }

        const keyFilter = this.getFeatureKeyFilter(featureKey);
        const feature: any = await Feature.findOne({ ...keyFilter, isActive: true }).lean();
        if (!feature) {
            return {
                enabled: false,
                limitType: 'NONE' as const,
                value: null,
                hasActiveSubscription: true,
                featureFound: false,
            };
        }

        const entitlement: any = await PlanFeature.findOne({ planId, featureId: feature._id }).lean();
        if (!entitlement) {
            return {
                enabled: false,
                limitType: 'NONE' as const,
                value: null,
                unit: feature.unit,
                key: feature.key,
                name: feature.name,
                hasActiveSubscription: true,
                featureFound: true,
            };
        }

        return {
            enabled: Boolean(entitlement.enabled),
            limitType: entitlement.limitType,
            value: entitlement.value,
            unit: feature.unit,
            key: feature.key,
            name: feature.name,
            hasActiveSubscription: true,
            featureFound: true,
        };
    }

    /**
     * Resolves Quick Meeting quota and cycle based strictly on PlanFeature.
     * Fail closed: if QUICK_MEETINGS is not in the plan, returns enabled: false.
     */
    static async getQuickMeetingLimits(companyId: string): Promise<{
        enabled: boolean;
        monthlyLimit: number;
        isUnlimited: boolean;
        billingCycle: string;
        planName: string;
    }> {
        let sub: any = await Subscription.findOne({
            companyId,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
        })
            .sort({ currentPeriodEnd: -1, createdAt: -1 })
            .populate('planId')
            .lean();

        if (!sub) {
            sub = await Subscription.findOne({ companyId })
                .sort({ createdAt: -1 })
                .populate('planId')
                .lean();
        }

        const plan = sub?.planId;
        const billingCycle: string = plan?.billingCycle || (sub ? 'MONTHLY' : 'FREE');
        const planName: string = plan?.name || (sub ? 'Subscription Plan' : 'Free Trial');

        const nowMs = Date.now();
        const periodEndMs = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : Infinity;
        const isNotExpired = !sub?.currentPeriodEnd || (periodEndMs + GRACE_PERIOD_MS) >= nowMs;
        const isActive = sub && (sub.status === 'ACTIVE' || sub.status === 'TRIALING' || (sub.status === 'PAST_DUE' && isNotExpired)) && isNotExpired;

        if (!isActive) {
            return {
                enabled: false,
                monthlyLimit: 0,
                isUnlimited: false,
                billingCycle,
                planName,
            };
        }

        const entitlement = await this.getEntitlement(companyId, 'QUICK_MEETINGS');

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

        // Tiered defaults based on billing cycle if not explicitly configured in PlanFeature
        let monthlyLimit = 7;
        let isUnlimited = false;

        const cycle = billingCycle.trim().toUpperCase();
        if (cycle === 'YEARLY' || cycle === 'ANNUAL' || cycle === '1_YEAR') {
            monthlyLimit = -1;
            isUnlimited = true;
        } else if (cycle === 'SEMI_ANNUAL' || cycle === '6_MONTHS') {
            monthlyLimit = 60;
            isUnlimited = false;
        }

        return {
            enabled: true,
            monthlyLimit,
            isUnlimited,
            billingCycle,
            planName,
        };
    }
}
