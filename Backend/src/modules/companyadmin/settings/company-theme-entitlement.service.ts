/**
 * WorkSphere — Company Theme Entitlement & Subscription Gateway
 * Server-authoritative entitlement enforcement for custom company branding.
 *
 * Rules:
 * - Active Semi-Annual ('SEMI_ANNUAL') or Annual ('YEARLY' / 'ANNUAL') subscriptions qualify.
 * - Monthly ('MONTHLY') or missing subscriptions do not qualify unless explicit
 *   'CUSTOM_COMPANY_THEME' feature flag is granted on the plan.
 * - Ineligible subscriptions (expired, cancelled, suspended, paused) cannot save/modify custom themes.
 * - Saved themes remain applied in read-only mode upon downgrade/expiry (never deleted).
 */

import { Types } from 'mongoose';
import { Subscription } from '../../super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../../super-admin/subscriptions/subscription.types';
import { Plan } from '../../super-admin/plans/plans.model';
import { Feature } from '../../super-admin/features/features.model';
import { PlanFeature } from '../../super-admin/plan-features/plan-features.model';

export type ThemeEntitlementReasonCode =
    | 'ENTITLED'
    | 'PLAN_UPGRADE_REQUIRED'
    | 'SUBSCRIPTION_EXPIRED'
    | 'SUBSCRIPTION_INACTIVE'
    | 'SUBSCRIPTION_PAST_DUE'
    | 'NO_SUBSCRIPTION';

export interface IThemeEntitlementResult {
    isEntitled: boolean;
    isReadOnly: boolean;
    reasonCode: ThemeEntitlementReasonCode;
    message: string;
    billingCycle?: string | null;
    planName?: string | null;
    status?: SubscriptionStatus | null;
}

interface EntitlementCacheEntry {
    result: IThemeEntitlementResult;
    cachedAt: number;
}

const entitlementCache = new Map<string, EntitlementCacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds TTL

export class CompanyThemeEntitlementService {
    /**
     * Clear entitlement cache for a company (called on plan change/renewal/cancellation)
     */
    static invalidateCache(companyId: string): void {
        entitlementCache.delete(String(companyId));
    }

    /**
     * Clear all cached entitlements
     */
    static clearAllCache(): void {
        entitlementCache.clear();
    }

    /**
     * Authoritatively check whether a company is entitled to customize and save company themes.
     * Evaluates persisted subscription records and plan billing cycle.
     */
    static async checkEntitlement(companyId: string): Promise<IThemeEntitlementResult> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            return {
                isEntitled: false,
                isReadOnly: true,
                reasonCode: 'NO_SUBSCRIPTION',
                message: 'Invalid company context. Theme customization requires an active company account.',
                billingCycle: null,
                planName: null,
                status: null,
            };
        }

        const normalizedCompanyId = String(companyId);
        const cached = entitlementCache.get(normalizedCompanyId);
        const now = Date.now();

        if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
            return cached.result;
        }

        const companyObjId = new Types.ObjectId(companyId);

        // 1. Fetch latest subscription for company
        const sub: any = await Subscription.findOne({ companyId: companyObjId })
            .sort({ createdAt: -1 })
            .populate('planId')
            .lean();

        let result: IThemeEntitlementResult;

        if (!sub) {
            result = {
                isEntitled: false,
                isReadOnly: true,
                reasonCode: 'NO_SUBSCRIPTION',
                message: 'No subscription record found. Custom company branding requires a Semi-Annual or Annual subscription plan.',
                billingCycle: null,
                planName: null,
                status: null,
            };
        } else {
            const plan = sub.planId as any;
            const planName: string = plan?.name || 'Custom Plan';
            const rawBillingCycle: string = (plan?.billingCycle || '').toUpperCase();
            const status: SubscriptionStatus = sub.status;

            // 2. Validate subscription lifecycle status
            const isActiveOrTrial = status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING;

            if (!isActiveOrTrial) {
                let reasonCode: ThemeEntitlementReasonCode = 'SUBSCRIPTION_INACTIVE';
                let statusMessage = `Subscription is currently ${status}.`;

                if (status === SubscriptionStatus.EXPIRED) {
                    reasonCode = 'SUBSCRIPTION_EXPIRED';
                    statusMessage = 'Subscription has expired.';
                } else if (status === SubscriptionStatus.PAST_DUE) {
                    reasonCode = 'SUBSCRIPTION_PAST_DUE';
                    statusMessage = 'Subscription is past due. Please resolve outstanding billing to modify theme settings.';
                }

                result = {
                    isEntitled: false,
                    isReadOnly: true,
                    reasonCode,
                    message: `${statusMessage} Custom company themes are preserved in read-only mode.`,
                    billingCycle: rawBillingCycle || null,
                    planName,
                    status,
                };
            } else {
                // 3. Subscription is ACTIVE or TRIALING — verify feature configuration
                const planId = sub.planId?._id || sub.planId;
                let featureConfigured = false;
                let featureEnabled = false;

                try {
                    const featureQuery: any = Feature.findOne({
                        key: { $in: ['CUSTOM_COMPANY_THEME', 'CUSTOM_THEME', 'CUSTOM_BRANDING'] },
                        isActive: true,
                    });
                    const feature = typeof featureQuery?.lean === 'function' ? await featureQuery.lean() : await featureQuery;

                    if (feature && planId) {
                        const pfQuery: any = PlanFeature.findOne({
                            planId: new Types.ObjectId(String(planId)),
                            featureId: feature._id,
                        });
                        const pf = typeof pfQuery?.lean === 'function' ? await pfQuery.lean() : await pfQuery;

                        if (pf) {
                            featureConfigured = true;
                            featureEnabled = Boolean(pf.enabled);
                        }
                    }
                } catch {
                    // Safe fallback for unconfigured or unmocked DB models
                }

                if (featureConfigured) {
                    if (featureEnabled) {
                        result = {
                            isEntitled: true,
                            isReadOnly: false,
                            reasonCode: 'ENTITLED',
                            message: 'Company is entitled to custom theme customization on this plan.',
                            billingCycle: rawBillingCycle,
                            planName,
                            status,
                        };
                    } else {
                        result = {
                            isEntitled: false,
                            isReadOnly: true,
                            reasonCode: 'PLAN_UPGRADE_REQUIRED',
                            message: 'Custom company themes are not included in your current subscription plan. Please upgrade your subscription to customize branding.',
                            billingCycle: rawBillingCycle,
                            planName,
                            status,
                        };
                    }
                } else {
                    // Fallback for legacy plans / unconfigured plans without PlanFeature records
                    const isQualifyingCycle =
                        rawBillingCycle === 'SEMI_ANNUAL' ||
                        rawBillingCycle === 'YEARLY' ||
                        rawBillingCycle === 'ANNUAL';

                    if (isQualifyingCycle) {
                        result = {
                            isEntitled: true,
                            isReadOnly: false,
                            reasonCode: 'ENTITLED',
                            message: 'Company is entitled to custom theme customization on this plan.',
                            billingCycle: rawBillingCycle,
                            planName,
                            status,
                        };
                    } else {
                        result = {
                            isEntitled: false,
                            isReadOnly: true,
                            reasonCode: 'PLAN_UPGRADE_REQUIRED',
                            message: 'Custom company themes require a Semi-Annual or Annual subscription plan. Please upgrade your subscription to customize branding.',
                            billingCycle: rawBillingCycle,
                            planName,
                            status,
                        };
                    }
                }
            }
        }

        // Cache the result
        entitlementCache.set(normalizedCompanyId, {
            result,
            cachedAt: now,
        });

        return result;
    }

    /**
     * Checks if a plan has explicit CUSTOM_COMPANY_THEME feature enabled in PlanFeature
     */
    private static async hasExplicitFeatureOverride(planId: Types.ObjectId | string): Promise<boolean> {
        try {
            if (!planId) return false;
            const feature = await Feature.findOne({
                key: { $in: ['CUSTOM_COMPANY_THEME', 'CUSTOM_THEME', 'CUSTOM_BRANDING'] },
                isActive: true,
            }).lean();

            if (!feature) return false;

            const planFeature = await PlanFeature.findOne({
                planId: new Types.ObjectId(String(planId)),
                featureId: feature._id,
                enabled: true,
            }).lean();

            return Boolean(planFeature);
        } catch {
            return false;
        }
    }
}
export default CompanyThemeEntitlementService;
