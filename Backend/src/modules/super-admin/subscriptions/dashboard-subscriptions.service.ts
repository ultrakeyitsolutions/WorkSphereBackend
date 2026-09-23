import { Types } from 'mongoose';
import { Subscription } from './subscription.model';
import { SubscriptionStatus } from './subscription.types';
import { Payment } from './payment.model';
import { Company } from '../companies/company.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { AppError } from '../../../utils/AppError';

export class DashboardSubscriptionsService {
    /**
     * Subscriptions summary metrics.
     */
    public static async getSummary() {
        const [
            active,
            trialing,
            expired,
            cancelled,
            totalSubscriptions,
            paymentAgg,
        ] = await Promise.all([
            Subscription.countDocuments({ status: SubscriptionStatus.ACTIVE }),
            Subscription.countDocuments({ status: SubscriptionStatus.TRIALING }),
            Subscription.countDocuments({ status: SubscriptionStatus.EXPIRED }),
            Subscription.countDocuments({ status: SubscriptionStatus.CANCELLED }),
            Subscription.countDocuments({}),
            Payment.aggregate([
                { $match: { status: 'PAID' } },
                { $group: { _id: null, totalRevenue: { $sum: '$amount' }, transactionCount: { $sum: 1 } } },
            ]),
        ]);

        const totalRevenue = paymentAgg.length > 0 ? paymentAgg[0].totalRevenue : 0;
        const totalPaidTransactions = paymentAgg.length > 0 ? paymentAgg[0].transactionCount : 0;

        return {
            total: totalSubscriptions,
            active,
            trial: trialing,
            expired,
            cancelled,
            revenue: {
                totalAmount: totalRevenue,
                transactionCount: totalPaidTransactions,
            },
        };
    }

    /**
     * List all subscriptions with pagination and filtering.
     */
    public static async listSubscriptions(
        pagination: PaginationParams,
        filters: { search?: string; plan?: string; status?: string }
    ): Promise<PaginatedResult<any>> {
        const query: any = {};

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [subscriptions, total] = await Promise.all([
            Subscription.find(query)
                .populate('companyId', 'name slug domain status')
                .populate('planId', 'name slug price billingCycle')
                .populate('scheduledPlanId', 'name slug')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            Subscription.countDocuments(query),
        ]);

        let items = subscriptions.map((sub: any) => ({
            id: sub._id,
            company: sub.companyId
                ? {
                      id: sub.companyId._id,
                      name: sub.companyId.name,
                      slug: sub.companyId.slug,
                      status: sub.companyId.status,
                  }
                : null,
            plan: sub.planId
                ? {
                      id: sub.planId._id,
                      name: sub.planId.name,
                      slug: sub.planId.slug,
                      price: sub.planId.price,
                      billingCycle: sub.planId.billingCycle,
                  }
                : null,
            status: sub.status,
            startedAt: sub.startedAt,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            pausedAt: sub.pausedAt,
            createdAt: sub.createdAt,
            updatedAt: sub.updatedAt,
        }));

        if (filters.search) {
            const term = filters.search.toLowerCase();
            items = items.filter(
                (item) =>
                    item.company?.name?.toLowerCase().includes(term) ||
                    item.company?.slug?.toLowerCase().includes(term) ||
                    item.plan?.name?.toLowerCase().includes(term)
            );
        }

        if (filters.plan) {
            items = items.filter(
                (item) =>
                    item.plan?.slug?.toLowerCase() === filters.plan?.toLowerCase() ||
                    item.plan?.name?.toLowerCase() === filters.plan?.toLowerCase()
            );
        }

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get company-specific subscription details.
     */
    public static async getCompanySubscription(companyId: string) {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const company = await Company.findById(companyId);
        if (!company || company.status === 'DELETED') {
            throw AppError.notFound('Company not found');
        }

        const subscription = await Subscription.findOne({ companyId: new Types.ObjectId(companyId) })
            .populate('planId')
            .populate('scheduledPlanId')
            .lean();

        if (!subscription) {
            return {
                companyId,
                companyName: company.name,
                hasActiveSubscription: false,
                subscription: null,
            };
        }

        return {
            companyId,
            companyName: company.name,
            hasActiveSubscription: subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.TRIALING,
            subscription: {
                id: subscription._id,
                plan: subscription.planId,
                scheduledPlan: subscription.scheduledPlanId,
                status: subscription.status,
                startedAt: subscription.startedAt,
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                pausedAt: subscription.pausedAt,
                resumeAt: subscription.resumeAt,
                pauseReason: subscription.pauseReason,
                cancellationReason: subscription.cancellationReason,
                createdAt: subscription.createdAt,
                updatedAt: subscription.updatedAt,
            },
        };
    }
}
