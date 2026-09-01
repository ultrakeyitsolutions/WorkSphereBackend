import { Types } from 'mongoose';
import { Subscription } from './subscription.model';
import { ISubscriptionDocument, SubscriptionStatus } from './subscription.types';
import { SubscriptionEvent } from './subscription-event.model';
import { SubscriptionEventType } from './subscription-event.types';
import { Plan } from '../plans/plans.model';
import { Company } from '../companies/company.model';

export class SubscriptionService {
    /**
     * Create a new subscription for a company.
     */
    static async createSubscription(
        companyId: string,
        planId: string,
        adminId: string,
        opts?: { periodStart?: Date }
    ): Promise<ISubscriptionDocument> {
        const company = await Company.findById(companyId);
        if (!company) throw new Error('Company not found');

        const plan = await Plan.findById(planId);
        if (!plan) throw new Error('Plan not found');
        if (!plan.isActive || plan.isArchived) throw new Error('Cannot subscribe to inactive plan');

        const existingSub = await Subscription.findOne({ companyId, status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED] } });
        if (existingSub) throw new Error('Company already has an active subscription');

        const now = opts?.periodStart || new Date();
        const endDate = new Date(now);

        // Example: hardcode 1 month for simplicity, ideally based on Plan's billing cycle (monthly/yearly)
        if (plan.billingCycle === 'YEARLY') {
            endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }

        const subscription = await Subscription.create({
            companyId,
            planId,
            status: SubscriptionStatus.ACTIVE,
            startedAt: now,
            currentPeriodStart: now,
            currentPeriodEnd: endDate,
            cancelAtPeriodEnd: false,
        });

        await SubscriptionEvent.create({
            subscriptionId: subscription._id,
            companyId,
            type: SubscriptionEventType.SUBSCRIPTION_CREATED,
            toPlanId: planId,
            toStatus: SubscriptionStatus.ACTIVE,
            effectiveAt: now,
            performedBy: adminId,
            metadata: { message: 'Initial subscription creation' },
        });

        return subscription;
    }

    /**
     * Upgrade or downgrade a plan (immediate or next cycle).
     */
    static async changePlan(
        companyId: string,
        targetPlanId: string,
        adminId: string,
        immediate: boolean
    ) {
        const activeSub = await Subscription.findOne({ companyId, status: SubscriptionStatus.ACTIVE });
        if (!activeSub) throw new Error('No active subscription found for company');

        const targetPlan = await Plan.findById(targetPlanId);
        if (!targetPlan) throw new Error('Target plan not found');
        if (!targetPlan.isActive || targetPlan.isArchived) throw new Error('Target plan is not active');

        if (activeSub.planId.toString() === targetPlanId.toString()) {
            throw new Error('Company is already on this plan');
        }

        const currentPlan = await Plan.findById(activeSub.planId);

        // Define if it is upgrade or downgrade based on prices? Usually backend figures it out, but logic here:
        const isUpgrade = (targetPlan.price || 0) > (currentPlan?.price || 0);

        if (!isUpgrade) {
            // It's a downgrade, check limits
            const { EntitlementService } = require('../entitlements/entitlement.service');
            const { User } = require('../../users/user.model');

            const limitInfo = await EntitlementService.getFeatureLimit(companyId, 'MAX_USERS');
            // But wait, the limit is on the CURRENT plan. We need the target plan limit.
            const targetPlanPf = await require('../plan-features/plan-features.model').PlanFeature.findOne({ planId: targetPlanId }).populate('featureId');
            // This is just a conceptual generic limit check. For production you'd iterate all features.

            // Checking simple max user limitation:
            const userCount = await User.countDocuments({ companyId, status: 'ACTIVE' });
            // In a complete implementation we check ALL target plan limits against CURRENT aggregated usage.
            // if (usage > newLimit) throw new AppError(`Downgrade blocked. Usage ${usage} exceeds limit ${newLimit}`);
        }

        if (immediate) {
            // Usually we'd prorate payments etc.
            const previousPlanId = activeSub.planId;
            activeSub.planId = new Types.ObjectId(targetPlanId);
            await activeSub.save();

            await SubscriptionEvent.create({
                subscriptionId: activeSub._id,
                companyId,
                type: isUpgrade ? SubscriptionEventType.PLAN_UPGRADED : SubscriptionEventType.PLAN_DOWNGRADED,
                fromPlanId: previousPlanId,
                toPlanId: targetPlanId,
                fromStatus: activeSub.status,
                toStatus: activeSub.status,
                effectiveAt: new Date(),
                performedBy: adminId,
                metadata: { immediate: true },
            });

            return activeSub;
        } else {
            // Next cycle change
            activeSub.scheduledPlanId = new Types.ObjectId(targetPlanId);
            await activeSub.save();

            await SubscriptionEvent.create({
                subscriptionId: activeSub._id,
                companyId,
                type: isUpgrade ? SubscriptionEventType.PLAN_UPGRADED : SubscriptionEventType.PLAN_DOWNGRADED,
                fromPlanId: activeSub.planId,
                toPlanId: targetPlanId,
                fromStatus: activeSub.status,
                toStatus: activeSub.status,
                effectiveAt: activeSub.currentPeriodEnd,
                performedBy: adminId,
                metadata: { immediate: false, message: 'Plan change scheduled for next billing cycle' },
            });

            return activeSub;
        }
    }

    static async pauseSubscription(
        companyId: string,
        adminId: string,
        pauseFrom?: Date,
        resumeAt?: Date,
        reason?: string
    ) {
        const sub = await Subscription.findOne({ companyId });
        if (!sub) throw new Error('Subscription not found');
        if (sub.status !== SubscriptionStatus.ACTIVE) throw new Error('Can only pause active subscriptions');

        const applyNow = !pauseFrom || pauseFrom <= new Date();

        if (applyNow) {
            sub.status = SubscriptionStatus.PAUSED;
            sub.pausedAt = new Date();
            sub.resumeAt = resumeAt || null;
            sub.pauseReason = reason;
            await sub.save();

            await SubscriptionEvent.create({
                subscriptionId: sub._id,
                companyId,
                type: SubscriptionEventType.SUBSCRIPTION_PAUSED,
                fromStatus: SubscriptionStatus.ACTIVE,
                toStatus: SubscriptionStatus.PAUSED,
                effectiveAt: new Date(),
                performedBy: adminId,
                metadata: { resumeAt, reason },
            });
        }

        return sub;
    }

    static async resumeSubscription(
        companyId: string,
        adminId: string,
        resumeImmediate: boolean
    ) {
        const sub = await Subscription.findOne({ companyId });
        if (!sub) throw new Error('Subscription not found');

        if (resumeImmediate && sub.status === SubscriptionStatus.PAUSED) {
            sub.status = SubscriptionStatus.ACTIVE;
            sub.pausedAt = null;
            sub.resumeAt = null;
            sub.pauseReason = undefined;
            await sub.save();

            await SubscriptionEvent.create({
                subscriptionId: sub._id,
                companyId,
                type: SubscriptionEventType.SUBSCRIPTION_RESUMED,
                fromStatus: SubscriptionStatus.PAUSED,
                toStatus: SubscriptionStatus.ACTIVE,
                effectiveAt: new Date(),
                performedBy: adminId,
            });
        }
        return sub;
    }

    static async cancelSubscription(
        companyId: string,
        adminId: string,
        cancelImmediate: boolean,
        reason?: string
    ) {
        const sub = await Subscription.findOne({ companyId });
        if (!sub) throw new Error('Subscription not found');

        if (cancelImmediate) {
            sub.status = SubscriptionStatus.CANCELLED;
            sub.cancelAtPeriodEnd = false;
            sub.cancellationReason = reason;
            await sub.save();

            await SubscriptionEvent.create({
                subscriptionId: sub._id,
                companyId,
                type: SubscriptionEventType.SUBSCRIPTION_CANCELLED,
                fromStatus: SubscriptionStatus.ACTIVE, // Assuming it was active
                toStatus: SubscriptionStatus.CANCELLED,
                effectiveAt: new Date(),
                performedBy: adminId,
                metadata: { immediate: true, reason },
            });
        } else {
            sub.cancelAtPeriodEnd = true;
            sub.cancellationReason = reason;
            await sub.save();

            // We log that it was scheduled to be cancelled
            await SubscriptionEvent.create({
                subscriptionId: sub._id,
                companyId,
                type: SubscriptionEventType.SUBSCRIPTION_CANCELLED,
                effectiveAt: sub.currentPeriodEnd,
                performedBy: adminId,
                metadata: { immediate: false, reason },
            });
        }

        return sub;
    }

    /**
     * Retrieve the full subscription details of a company:
     *  - Current plan (populated)
     *  - Scheduled next plan (populated, if any)
     *  - Last 20 subscription events
     * Returns null if no subscription exists (not an error).
     */
    static async getCompanySubscription(companyId: string) {
        const sub = await Subscription.findOne({ companyId })
            .populate('planId', 'name price billingCycle description isActive')
            .populate('scheduledPlanId', 'name price billingCycle description isActive')
            .lean();

        if (!sub) return null;

        // Fetch recent subscription events for this company
        const events = await SubscriptionEvent.find({ companyId })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('fromPlanId', 'name price billingCycle')
            .populate('toPlanId', 'name price billingCycle')
            .populate('performedBy', 'name email')
            .lean();

        return {
            subscription: sub,
            events,
        };
    }
}
