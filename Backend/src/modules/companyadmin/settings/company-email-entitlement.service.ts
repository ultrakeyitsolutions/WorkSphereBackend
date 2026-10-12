/**
 * WorkSphere — Company Invitation Email Entitlement & Subscription Gateway
 * Server-authoritative entitlement enforcement for custom company invitation email.
 *
 * Rules:
 * - Company must be ACTIVE.
 * - Subscription must be ACTIVE or TRIALING (EXPIRED, PAST_DUE, PAUSED, CANCELLED do not qualify).
 * - Plan must include explicit 'CUSTOM_COMPANY_EMAIL' entitlement in PlanFeature.
 * - Ineligible subscriptions fall back to the platform sender and cannot configure custom sender.
 */

import { Types } from 'mongoose';
import { Subscription } from '../../super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../../super-admin/subscriptions/subscription.types';
import { Feature } from '../../super-admin/features/features.model';
import { PlanFeature } from '../../super-admin/plan-features/plan-features.model';
import { Company } from '../../super-admin/companies/company.model';
import { IEmailEntitlementResult, EmailEntitlementReasonCode } from './company-email.types';
import { EntitlementService } from '../../../services/entitlement.service';

interface EmailEntitlementCacheEntry {
    result: IEmailEntitlementResult;
    cachedAt: number;
}

const entitlementCache = new Map<string, EmailEntitlementCacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds TTL

export class CompanyEmailEntitlementService {
    /**
     * Clear entitlement cache for a company (called on plan change/renewal/cancellation/settings update)
     */
    static invalidateCache(companyId: string): void {
        entitlementCache.delete(String(companyId));
        EntitlementService.invalidateCache(String(companyId));
    }

    /**
     * Clear all cached entitlements
     */
    static clearAllCache(): void {
        entitlementCache.clear();
        EntitlementService.clearAllCache();
    }

    /**
     * Authoritatively check whether a company is entitled to configure and use custom invitation emails.
     * Evaluates company state, subscription lifecycle status, and plan features.
     */
    static async checkEntitlement(companyId: string): Promise<IEmailEntitlementResult> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            return {
                isEntitled: false,
                reasonCode: 'NO_SUBSCRIPTION',
                message: 'Invalid company context. Custom company email requires an active company account.',
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

        // 1. Verify company state
        const company = await Company.findById(companyObjId).lean();
        if (!company || company.status !== 'ACTIVE' || !company.isActive) {
            const result: IEmailEntitlementResult = {
                isEntitled: false,
                reasonCode: 'COMPANY_INACTIVE',
                message: 'Company account is not active.',
                billingCycle: null,
                planName: null,
                status: null,
            };
            entitlementCache.set(normalizedCompanyId, { result, cachedAt: now });
            return result;
        }

        // 2. Fetch latest subscription for company
        const sub: any = await Subscription.findOne({ companyId: companyObjId })
            .sort({ createdAt: -1 })
            .populate('planId')
            .lean();

        let result: IEmailEntitlementResult;

        if (!sub) {
            result = {
                isEntitled: false,
                reasonCode: 'NO_SUBSCRIPTION',
                message: 'No subscription record found. Custom company email requires a subscription plan with the custom email entitlement.',
                billingCycle: null,
                planName: null,
                status: null,
            };
        } else {
            const plan = sub.planId as any;
            const planName: string = plan?.name || 'Custom Plan';
            const rawBillingCycle: string = (plan?.billingCycle || '').toUpperCase();
            const status: SubscriptionStatus = sub.status;

            // 3. Validate subscription lifecycle status
            const isActiveOrTrial = status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING;

            if (!isActiveOrTrial) {
                let reasonCode: EmailEntitlementReasonCode = 'SUBSCRIPTION_INACTIVE';
                let statusMessage = `Subscription is currently ${status}.`;

                if (status === SubscriptionStatus.EXPIRED) {
                    reasonCode = 'SUBSCRIPTION_EXPIRED';
                    statusMessage = 'Subscription has expired.';
                } else if (status === SubscriptionStatus.PAST_DUE) {
                    reasonCode = 'SUBSCRIPTION_PAST_DUE';
                    statusMessage = 'Subscription is past due. Please resolve outstanding billing to use custom email.';
                }

                result = {
                    isEntitled: false,
                    reasonCode,
                    message: `${statusMessage} Platform sender fallback is active.`,
                    billingCycle: rawBillingCycle || null,
                    planName,
                    status,
                };
            } else {
                // 4. Verify explicit plan feature entitlement: CUSTOM_COMPANY_EMAIL
                // Uses centralized EntitlementService with fallback to direct plan lookup using normalized key filter
                const hasEntitlement = (await EntitlementService.hasFeature(normalizedCompanyId, 'CUSTOM_COMPANY_EMAIL'))
                    || (await this.hasPlanEmailEntitlement(sub.planId?._id || sub.planId));

                if (hasEntitlement) {
                    result = {
                        isEntitled: true,
                        reasonCode: 'ENTITLED',
                        message: 'Company is entitled to configure and send from a custom invitation email.',
                        billingCycle: rawBillingCycle || null,
                        planName,
                        status,
                    };
                } else {
                    result = {
                        isEntitled: false,
                        reasonCode: 'PLAN_UPGRADE_REQUIRED',
                        message: 'Custom company email is not included in your organization\'s subscription plan. Please upgrade to a plan with the Custom Company Email feature.',
                        billingCycle: rawBillingCycle || null,
                        planName,
                        status,
                    };
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
     * Checks if a plan has explicit CUSTOM_COMPANY_EMAIL feature enabled in PlanFeature
     */
    private static async hasPlanEmailEntitlement(planId: Types.ObjectId | string): Promise<boolean> {
        try {
            if (!planId) return false;
            const keyFilter = EntitlementService.getFeatureKeyFilter('CUSTOM_COMPANY_EMAIL');
            const feature = await Feature.findOne({
                ...keyFilter,
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

export default CompanyEmailEntitlementService;
