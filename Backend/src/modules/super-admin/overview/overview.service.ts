import { Company } from '../companies/company.model';
import { User } from '../../users/user.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Subscription } from '../subscriptions/subscription.model';
import { SubscriptionStatus } from '../subscriptions/subscription.types';
import { OverviewSummaryData } from './overview.types';

export class OverviewService {
    public static async getSummary(): Promise<OverviewSummaryData> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [
            totalCompanies,
            activeCompanies,
            newCompanies,
            totalUsers,
            activeUsers,
            newUsers,
            totalProjects,
            activeProjects,
            completedProjects,
            activeSubscriptions,
            trialSubscriptions,
            expiredSubscriptions,
            cancelledSubscriptions,
        ] = await Promise.all([
            // Companies
            Company.countDocuments({ status: { $ne: 'DELETED' } }),
            Company.countDocuments({ status: 'ACTIVE' }),
            Company.countDocuments({ status: { $ne: 'DELETED' }, createdAt: { $gte: thirtyDaysAgo } }),

            // Users
            User.countDocuments({ status: { $ne: 'DEACTIVATED' } }),
            User.countDocuments({ status: 'ACTIVE' }),
            User.countDocuments({ status: { $ne: 'DEACTIVATED' }, createdAt: { $gte: thirtyDaysAgo } }),

            // Projects
            Project.countDocuments({ deletedAt: null }),
            Project.countDocuments({ deletedAt: null, status: ProjectStatus.ACTIVE }),
            Project.countDocuments({ deletedAt: null, status: ProjectStatus.COMPLETED }),

            // Subscriptions
            Subscription.countDocuments({ status: SubscriptionStatus.ACTIVE }),
            Subscription.countDocuments({ status: SubscriptionStatus.TRIALING }),
            Subscription.countDocuments({ status: SubscriptionStatus.EXPIRED }),
            Subscription.countDocuments({ status: SubscriptionStatus.CANCELLED }),
        ]);

        return {
            companies: {
                total: totalCompanies,
                active: activeCompanies,
                new: newCompanies,
            },
            users: {
                total: totalUsers,
                active: activeUsers,
                new: newUsers,
            },
            projects: {
                total: totalProjects,
                active: activeProjects,
                completed: completedProjects,
            },
            subscriptions: {
                active: activeSubscriptions,
                trial: trialSubscriptions,
                expired: expiredSubscriptions,
                cancelled: cancelledSubscriptions,
            },
        };
    }
}
