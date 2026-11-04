import { Types } from 'mongoose';
import { Subscription } from './subscription.model';
import { ISubscriptionDocument, SubscriptionStatus } from './subscription.types';
import { SubscriptionEvent } from './subscription-event.model';
import { SubscriptionEventType } from './subscription-event.types';
import { Plan } from '../plans/plans.model';
import { Company } from '../companies/company.model';
import { User } from '../../users/user.model';
import { Feature } from '../features/features.model';
import { PlanFeature } from '../plan-features/plan-features.model';
import { CompanyThemeEntitlementService } from '../../companyadmin/settings/company-theme-entitlement.service';
import { CompanyEmailEntitlementService } from '../../companyadmin/settings/company-email-entitlement.service';
import { EntitlementService } from '../../../services/entitlement.service';
import { SubscriptionEntitlementSyncService } from '../../../services/subscription-entitlement-sync.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

export class SubscriptionService {
    /**
     * Invalidate all subscription and entitlement caches for a company.
     */
    private static invalidateCompanyEntitlementCaches(companyId: string): void {
        CompanyThemeEntitlementService.invalidateCache(companyId);
        CompanyEmailEntitlementService.invalidateCache(companyId);
        EntitlementService.invalidateCache(companyId);
    }

    /**
     * Calculates period end date from a start date and plan billing cycle.
     * Accurately supports yearly plans, annual aliases, and leap years.
     */
    public static calculatePeriodEnd(startDate: Date, billingCycle: string, durationDays?: number): Date {
        const endDate = new Date(startDate);
        if (durationDays && durationDays > 0) {
            endDate.setDate(endDate.getDate() + durationDays);
            return endDate;
        }

        const cycle = (billingCycle || '').toString().trim().toUpperCase();
        if (cycle === 'YEARLY' || cycle === 'ANNUAL' || cycle === '1_YEAR') {
            const startYear = endDate.getFullYear();
            const startMonth = endDate.getMonth();
            const startDay = endDate.getDate();
            endDate.setFullYear(startYear + 1);
            // Leap year safety: if Feb 29 rolled over to March 1, clamp to Feb 28
            if (startMonth === 1 && startDay === 29 && endDate.getMonth() !== 1) {
                endDate.setDate(0);
            }
        } else if (cycle === 'SEMI_ANNUAL' || cycle === '6_MONTHS') {
            endDate.setMonth(endDate.getMonth() + 6);
        } else if (cycle === 'QUARTERLY' || cycle === '3_MONTHS') {
            endDate.setMonth(endDate.getMonth() + 3);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }
        return endDate;
    }

    /**
     * Create a new subscription for a company.
     */
    static async createSubscription(
        companyId: string,
        planId: string,
        adminId: string,
        opts?: { periodStart?: Date; durationDays?: number }
    ): Promise<ISubscriptionDocument> {
        const company = await Company.findById(companyId);
        if (!company) throw new Error('Company not found');

        const plan = await Plan.findById(planId);
        if (!plan) throw new Error('Plan not found');
        if (!plan.isActive || plan.isArchived) throw new Error('Cannot subscribe to inactive plan');

        const existingSub = await Subscription.findOne({
            companyId,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED] },
        }).sort({ currentPeriodEnd: -1, createdAt: -1 });
        if (existingSub) throw new Error('Company already has an active subscription');

        const now = opts?.periodStart || new Date();
        const endDate = this.calculatePeriodEnd(now, plan.billingCycle || 'MONTHLY', opts?.durationDays);

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

        await SubscriptionEntitlementSyncService.sync({
            companyId,
            toPlanId: planId,
            actorId: adminId,
            action: AuditAction.SUBSCRIPTION_CREATED,
            effectiveDate: now,
            metadata: { billingCycle: plan.billingCycle, periodEnd: endDate },
        });

        return subscription;
    }

    /**
     * SuperAdmin grant of a complimentary subscription plan.
     * Never fabricates payment records or routes through payment gateways.
     */
    static async grantComplimentaryPlan(
        companyId: string,
        targetPlanId: string,
        adminId: string,
        opts?: { reason?: string; durationDays?: number; periodEnd?: Date }
    ): Promise<ISubscriptionDocument> {
        const company = await Company.findById(companyId);
        if (!company) throw new Error('Company not found');

        const targetPlan = await Plan.findById(targetPlanId);
        if (!targetPlan) throw new Error('Target plan not found');
        if (!targetPlan.isActive || targetPlan.isArchived) throw new Error('Target plan is not active');

        const now = new Date();
        const endDate = opts?.periodEnd
            ? new Date(opts.periodEnd)
            : this.calculatePeriodEnd(now, targetPlan.billingCycle || 'YEARLY', opts?.durationDays || 365);

        let activeSub = await Subscription.findOne({
            companyId: new Types.ObjectId(companyId),
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED] },
        }).sort({ currentPeriodEnd: -1, createdAt: -1 });

        if (!activeSub) {
            activeSub = await Subscription.findOne({ companyId: new Types.ObjectId(companyId) }).sort({ createdAt: -1 });
        }

        const prevPlanId = activeSub?.planId ? String(activeSub.planId) : null;

        if (!activeSub) {
            activeSub = await Subscription.create({
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(targetPlanId),
                status: SubscriptionStatus.ACTIVE,
                startedAt: now,
                currentPeriodStart: now,
                currentPeriodEnd: endDate,
                cancelAtPeriodEnd: false,
                isComplimentary: true,
                complimentaryReason: opts?.reason || 'Complimentary plan granted by SuperAdmin',
                complimentaryGrantedBy: new Types.ObjectId(adminId),
                complimentaryGrantedAt: now,
                pricingOverride: 0,
            });
        } else {
            activeSub.planId = new Types.ObjectId(targetPlanId);
            activeSub.status = SubscriptionStatus.ACTIVE;
            activeSub.currentPeriodStart = now;
            activeSub.currentPeriodEnd = endDate;
            activeSub.cancelAtPeriodEnd = false;
            activeSub.scheduledPlanId = undefined;
            activeSub.isComplimentary = true;
            activeSub.complimentaryReason = opts?.reason || 'Complimentary plan granted by SuperAdmin';
            activeSub.complimentaryGrantedBy = new Types.ObjectId(adminId);
            activeSub.complimentaryGrantedAt = now;
            activeSub.pricingOverride = 0;
            await activeSub.save();
        }

        await SubscriptionEvent.create({
            subscriptionId: activeSub._id,
            companyId,
            type: SubscriptionEventType.COMPLIMENTARY_PLAN_GRANTED,
            fromPlanId: prevPlanId ? new Types.ObjectId(prevPlanId) : undefined,
            toPlanId: new Types.ObjectId(targetPlanId),
            fromStatus: activeSub.status,
            toStatus: SubscriptionStatus.ACTIVE,
            effectiveAt: now,
            performedBy: adminId,
            metadata: {
                reason: opts?.reason || 'Complimentary plan granted by SuperAdmin',
                durationDays: opts?.durationDays,
                periodEnd: endDate,
            },
        });

        await SubscriptionEntitlementSyncService.sync({
            companyId,
            fromPlanId: prevPlanId,
            toPlanId: targetPlanId,
            actorId: adminId,
            action: AuditAction.COMPLIMENTARY_PLAN_GRANTED,
            isComplimentary: true,
            reason: opts?.reason || 'Complimentary plan granted by SuperAdmin',
            effectiveDate: now,
            metadata: { durationDays: opts?.durationDays, periodEnd: endDate },
        });

        return activeSub;
    }

    /**
     * Upgrade or downgrade a plan (immediate activation or scheduled for next billing cycle).
     */
    static async changePlan(
        companyId: string,
        targetPlanId: string,
        adminId: string,
        immediate: boolean = true,
        reason?: string
    ) {
        const targetPlan = await Plan.findById(targetPlanId);
        if (!targetPlan) throw new Error('Target plan not found');
        if (!targetPlan.isActive || targetPlan.isArchived) throw new Error('Target plan is not active');

        const activeSub = await Subscription.findOne({
            companyId,
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED] },
        }).sort({ currentPeriodEnd: -1, createdAt: -1 });

        // If no existing active/trialing/paused subscription, create one immediately
        if (!activeSub) {
            return await this.createSubscription(companyId, targetPlanId, adminId);
        }

        if (activeSub.planId.toString() === targetPlanId.toString() && !activeSub.scheduledPlanId) {
            throw new Error('Company is already on this plan');
        }

        const currentPlan = await Plan.findById(activeSub.planId);

        // Define if it is upgrade or downgrade based on prices
        const isUpgrade = (targetPlan.price || 0) > (currentPlan?.price || 0);

        if (!isUpgrade) {
            // Downgrade guard: ensure current active usage is within target plan limits
            const userCount = await User.countDocuments({ companyId: new Types.ObjectId(companyId), status: 'ACTIVE' });

            // Look up the target plan limits
            const maxUsersFeature = await Feature.findOne({ key: 'MAX_USERS' });
            if (maxUsersFeature) {
                const planLimit = await PlanFeature.findOne({
                    planId: targetPlanId,
                    featureId: maxUsersFeature._id,
                });

                if (planLimit && planLimit.enabled && planLimit.limitType === 'LIMITED' && planLimit.value !== null) {
                    if (userCount > planLimit.value) {
                        throw new Error(`Downgrade blocked — current user count (${userCount}) exceeds the target plan limit of ${planLimit.value}.`);
                    }
                }
            }
        }

        if (immediate) {
            const previousPlanId = activeSub.planId;
            activeSub.planId = new Types.ObjectId(targetPlanId);
            activeSub.status = SubscriptionStatus.ACTIVE;
            activeSub.scheduledPlanId = undefined; // Clear any pending scheduled plan change
            await activeSub.save();

            await SubscriptionEvent.create({
                subscriptionId: activeSub._id,
                companyId,
                type: isUpgrade ? SubscriptionEventType.PLAN_UPGRADED : SubscriptionEventType.PLAN_DOWNGRADED,
                fromPlanId: previousPlanId,
                toPlanId: targetPlanId,
                fromStatus: activeSub.status,
                toStatus: SubscriptionStatus.ACTIVE,
                effectiveAt: new Date(),
                performedBy: adminId,
                metadata: { immediate: true, reason },
            });

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                fromPlanId: previousPlanId,
                toPlanId: targetPlanId,
                actorId: adminId,
                action: isUpgrade ? AuditAction.SUBSCRIPTION_UPGRADED : AuditAction.SUBSCRIPTION_DOWNGRADED,
                reason,
                effectiveDate: new Date(),
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
                metadata: { immediate: false, reason, message: 'Plan change scheduled for next billing cycle' },
            });

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                fromPlanId: activeSub.planId,
                toPlanId: targetPlanId,
                actorId: adminId,
                action: isUpgrade ? AuditAction.SUBSCRIPTION_UPGRADED : AuditAction.SUBSCRIPTION_DOWNGRADED,
                reason,
                effectiveDate: activeSub.currentPeriodEnd,
                metadata: { immediate: false, scheduled: true, effectiveAt: activeSub.currentPeriodEnd },
            });

            return activeSub;
        }
    }

    /**
     * Atomically rolls over a scheduled plan change if its arrival date has passed.
     */
    static async reconcileScheduledSubscription(companyId: string): Promise<ISubscriptionDocument | null> {
        const sub = await Subscription.findOne({
            companyId: new Types.ObjectId(companyId),
            scheduledPlanId: { $ne: null },
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        }).sort({ currentPeriodEnd: -1, createdAt: -1 });

        if (!sub || !sub.scheduledPlanId || !sub.currentPeriodEnd) {
            return null;
        }

        const now = new Date();
        if (now < new Date(sub.currentPeriodEnd)) {
            return null; // Not due yet
        }

        const prevPlanId = sub.planId;
        const targetPlanId = sub.scheduledPlanId;
        const targetPlan = await Plan.findById(targetPlanId);

        const newPeriodStart = sub.currentPeriodEnd;
        const newPeriodEnd = this.calculatePeriodEnd(
            newPeriodStart,
            targetPlan?.billingCycle || 'MONTHLY'
        );

        sub.planId = targetPlanId;
        sub.scheduledPlanId = undefined;
        sub.currentPeriodStart = newPeriodStart;
        sub.currentPeriodEnd = newPeriodEnd;
        await sub.save();

        await SubscriptionEvent.create({
            subscriptionId: sub._id,
            companyId,
            type: SubscriptionEventType.PLAN_DOWNGRADED,
            fromPlanId: prevPlanId,
            toPlanId: targetPlanId,
            fromStatus: sub.status,
            toStatus: sub.status,
            effectiveAt: now,
            metadata: { message: 'Automated rollover of scheduled plan transition' },
        });

        await SubscriptionEntitlementSyncService.sync({
            companyId,
            fromPlanId: prevPlanId,
            toPlanId: targetPlanId,
            action: AuditAction.SUBSCRIPTION_DOWNGRADED,
            effectiveDate: now,
            metadata: { automatedRollover: true },
        });

        return sub;
    }

    static async pauseSubscription(
        companyId: string,
        adminId: string,
        pauseFrom?: Date,
        resumeAt?: Date,
        reason?: string
    ) {
        const sub = await Subscription.findOne({ companyId }).sort({ currentPeriodEnd: -1, createdAt: -1 });
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

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                toPlanId: sub.planId,
                actorId: adminId,
                action: AuditAction.SUBSCRIPTION_PAUSED,
                reason,
                effectiveDate: new Date(),
            });
        }

        return sub;
    }

    static async resumeSubscription(
        companyId: string,
        adminId: string,
        resumeImmediate: boolean
    ) {
        const sub = await Subscription.findOne({ companyId }).sort({ currentPeriodEnd: -1, createdAt: -1 });
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

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                toPlanId: sub.planId,
                actorId: adminId,
                action: AuditAction.SUBSCRIPTION_UPGRADED,
                effectiveDate: new Date(),
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
        const sub = await Subscription.findOne({ companyId }).sort({ currentPeriodEnd: -1, createdAt: -1 });
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
                fromStatus: SubscriptionStatus.ACTIVE,
                toStatus: SubscriptionStatus.CANCELLED,
                effectiveAt: new Date(),
                performedBy: adminId,
                metadata: { immediate: true, reason },
            });

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                toPlanId: sub.planId,
                actorId: adminId,
                action: AuditAction.SUBSCRIPTION_CANCELLED,
                reason,
                effectiveDate: new Date(),
            });
        } else {
            sub.cancelAtPeriodEnd = true;
            sub.cancellationReason = reason;
            await sub.save();

            // Log scheduled cancellation
            await SubscriptionEvent.create({
                subscriptionId: sub._id,
                companyId,
                type: SubscriptionEventType.SUBSCRIPTION_CANCELLED,
                effectiveAt: sub.currentPeriodEnd,
                performedBy: adminId,
                metadata: { immediate: false, reason },
            });

            await SubscriptionEntitlementSyncService.sync({
                companyId,
                toPlanId: sub.planId,
                actorId: adminId,
                action: AuditAction.SUBSCRIPTION_CANCELLED,
                reason,
                effectiveDate: sub.currentPeriodEnd,
                metadata: { scheduled: true, effectiveAt: sub.currentPeriodEnd },
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
        // If scheduled rollover has arrived, perform durable transition first
        try {
            await this.reconcileScheduledSubscription(companyId);
        } catch {
            // Non-blocking
        }

        let sub = await Subscription.findOne({
            companyId: new Types.ObjectId(companyId),
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAUSED] },
        })
            .sort({ currentPeriodEnd: -1, createdAt: -1 })
            .populate('planId', 'name price billingCycle description isActive')
            .populate('scheduledPlanId', 'name price billingCycle description isActive')
            .lean();

        if (!sub) {
            sub = await Subscription.findOne({ companyId: new Types.ObjectId(companyId) })
                .sort({ createdAt: -1 })
                .populate('planId', 'name price billingCycle description isActive')
                .populate('scheduledPlanId', 'name price billingCycle description isActive')
                .lean();
        }

        if (!sub) return null;

        // Fetch recent subscription events for this company
        const events = await SubscriptionEvent.find({ companyId: new Types.ObjectId(companyId) })
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
