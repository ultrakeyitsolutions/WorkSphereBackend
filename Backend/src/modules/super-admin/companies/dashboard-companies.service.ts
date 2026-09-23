import { Types } from 'mongoose';
import { Company } from './company.model';
import { User } from '../../users/user.model';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { Attendance, AttendanceStatus } from '../../attendance/attendance.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { Subscription } from '../subscriptions/subscription.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { AppError } from '../../../utils/AppError';

export class DashboardCompaniesService {
    /**
     * List companies with pagination, searching, filtering, and sorting.
     */
    public static async listCompanies(
        pagination: PaginationParams,
        filters: { search?: string; status?: string; subscription?: string }
    ): Promise<PaginatedResult<any>> {
        const query: any = { status: { $ne: 'DELETED' } };

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.$or = [
                { name: regex },
                { slug: regex },
                { domain: regex },
                { companyEmail: regex },
            ];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [companies, total] = await Promise.all([
            Company.find(query)
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .populate('adminId', 'name email status')
                .lean(),
            Company.countDocuments(query),
        ]);

        // Enrich with user counts and active subscription
        const companyIds = companies.map((c) => c._id);

        const [userCounts, subscriptions] = await Promise.all([
            User.aggregate([
                { $match: { companyId: { $in: companyIds }, status: { $ne: 'DEACTIVATED' } } },
                { $group: { _id: '$companyId', count: { $sum: 1 } } },
            ]),
            Subscription.find({ companyId: { $in: companyIds } })
                .populate('planId', 'name slug')
                .lean(),
        ]);

        const userCountMap = new Map<string, number>();
        userCounts.forEach((u: any) => userCountMap.set(String(u._id), u.count));

        const subscriptionMap = new Map<string, any>();
        subscriptions.forEach((s: any) => subscriptionMap.set(String(s.companyId), s));

        const items = companies.map((comp: any) => {
            const sub = subscriptionMap.get(String(comp._id));
            return {
                id: comp._id,
                name: comp.name,
                slug: comp.slug,
                domain: comp.domain,
                industry: comp.industry,
                size: comp.size,
                status: comp.status,
                isActive: comp.isActive,
                companyEmail: comp.companyEmail,
                companyPhone: comp.companyPhone,
                admin: comp.adminId
                    ? {
                          id: comp.adminId._id,
                          name: comp.adminId.name,
                          email: comp.adminId.email,
                          status: comp.adminId.status,
                      }
                    : null,
                userCount: userCountMap.get(String(comp._id)) || 0,
                subscription: sub
                    ? {
                          id: sub._id,
                          plan: sub.planId ? { id: sub.planId._id, name: sub.planId.name, slug: sub.planId.slug } : null,
                          status: sub.status,
                          currentPeriodEnd: sub.currentPeriodEnd,
                      }
                    : null,
                createdAt: comp.createdAt,
                updatedAt: comp.updatedAt,
            };
        });

        // Optional filter in-memory if subscription status filter is passed
        let finalItems = items;
        if (filters.subscription) {
            finalItems = items.filter(
                (item) => item.subscription?.status?.toLowerCase() === filters.subscription?.toLowerCase()
            );
        }

        return {
            items: finalItems,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get single company details with safe admin profile & counts.
     */
    public static async getCompanyDetails(companyId: string) {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } })
            .populate('adminId', 'name email status')
            .lean();

        if (!company) {
            throw AppError.notFound('Company not found');
        }

        const cId = new Types.ObjectId(companyId);

        const [totalUsers, activeUsers, totalProjects, activeProjects, subscription] = await Promise.all([
            User.countDocuments({ companyId: cId, status: { $ne: 'DEACTIVATED' } }),
            User.countDocuments({ companyId: cId, status: 'ACTIVE' }),
            Project.countDocuments({ companyId: cId, deletedAt: null }),
            Project.countDocuments({ companyId: cId, deletedAt: null, status: ProjectStatus.ACTIVE }),
            Subscription.findOne({ companyId: cId }).populate('planId', 'name slug price').lean(),
        ]);

        return {
            id: company._id,
            name: company.name,
            slug: company.slug,
            domain: company.domain,
            industry: company.industry,
            size: company.size,
            logoUrl: company.logoUrl,
            status: company.status,
            isActive: company.isActive,
            companyEmail: company.companyEmail,
            companyPhone: company.companyPhone,
            website: company.website,
            address: company.address,
            city: company.city,
            state: company.state,
            country: company.country,
            postalCode: company.postalCode,
            timezone: company.timezone,
            currency: company.currency,
            admin: company.adminId
                ? {
                      id: (company.adminId as any)._id,
                      name: (company.adminId as any).name,
                      email: (company.adminId as any).email,
                      status: (company.adminId as any).status,
                  }
                : null,
            userCount: totalUsers,
            activeUserCount: activeUsers,
            projectCount: totalProjects,
            activeProjectCount: activeProjects,
            subscription: subscription
                ? {
                      id: subscription._id,
                      plan: subscription.planId,
                      status: subscription.status,
                      startedAt: subscription.startedAt,
                      currentPeriodStart: subscription.currentPeriodStart,
                      currentPeriodEnd: subscription.currentPeriodEnd,
                  }
                : null,
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
        };
    }

    /**
     * Get complete company statistics.
     */
    public static async getCompanyStatistics(companyId: string) {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const company = await Company.findById(companyId);
        if (!company || company.status === 'DELETED') {
            throw AppError.notFound('Company not found');
        }

        const cId = new Types.ObjectId(companyId);

        const [
            totalUsers,
            activeUsers,
            totalProjects,
            activeProjects,
            completedProjects,
            totalTasks,
            completedTasks,
            activeCheckIns,
            totalAttendance,
            timeTrackingAgg,
        ] = await Promise.all([
            User.countDocuments({ companyId: cId, status: { $ne: 'DEACTIVATED' } }),
            User.countDocuments({ companyId: cId, status: 'ACTIVE' }),
            Project.countDocuments({ companyId: cId, deletedAt: null }),
            Project.countDocuments({ companyId: cId, deletedAt: null, status: ProjectStatus.ACTIVE }),
            Project.countDocuments({ companyId: cId, deletedAt: null, status: ProjectStatus.COMPLETED }),
            Task.countDocuments({ companyId: cId }),
            Task.countDocuments({ companyId: cId, progress: 100 }),
            Attendance.countDocuments({ companyId: cId, status: AttendanceStatus.CHECKED_IN }),
            Attendance.countDocuments({ companyId: cId }),
            TimeTracking.aggregate([
                { $match: { companyId: cId } },
                { $group: { _id: null, totalSeconds: { $sum: '$workedSeconds' } } },
            ]),
        ]);

        const totalWorkedHours = timeTrackingAgg.length > 0
            ? Math.round((timeTrackingAgg[0].totalSeconds / 3600) * 10) / 10
            : 0;

        return {
            companyId,
            users: {
                total: totalUsers,
                active: activeUsers,
            },
            projects: {
                total: totalProjects,
                active: activeProjects,
                completed: completedProjects,
            },
            tasks: {
                total: totalTasks,
                completed: completedTasks,
            },
            attendance: {
                activeCheckIns,
                totalRecords: totalAttendance,
            },
            timesheet: {
                totalWorkedHours,
            },
        };
    }

    /**
     * Get paginated company users.
     */
    public static async getCompanyUsers(
        companyId: string,
        pagination: PaginationParams,
        filters: { search?: string; role?: string; status?: string }
    ): Promise<PaginatedResult<any>> {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const query: any = {
            companyId: new Types.ObjectId(companyId),
            status: { $ne: 'DEACTIVATED' },
        };

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.$or = [{ name: regex }, { email: regex }];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password -grantedPermissions -revokedPermissions')
                .populate('role', 'name')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            User.countDocuments(query),
        ]);

        let items = users.map((u: any) => ({
            id: u._id,
            name: u.name,
            email: u.email,
            role: u.role ? (typeof u.role === 'object' ? u.role.name : u.role) : 'MEMBER',
            status: u.status,
            isActive: u.isActive,
            mfaEnabled: u.mfaEnabled,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
        }));

        if (filters.role) {
            items = items.filter((u) => u.role.toLowerCase() === filters.role?.toLowerCase());
        }

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get paginated company projects.
     */
    public static async getCompanyProjects(
        companyId: string,
        pagination: PaginationParams,
        filters: { search?: string; status?: string }
    ): Promise<PaginatedResult<any>> {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const query: any = {
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        };

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.name = regex;
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [projects, total] = await Promise.all([
            Project.find(query)
                .populate('createdById', 'name email')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            Project.countDocuments(query),
        ]);

        const items = projects.map((p: any) => ({
            id: p._id,
            name: p.name,
            description: p.description,
            type: p.type,
            priority: p.priority,
            status: p.status,
            startDate: p.startDate,
            endDate: p.endDate,
            createdBy: p.createdById ? { id: p.createdById._id, name: p.createdById.name } : null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }
}
