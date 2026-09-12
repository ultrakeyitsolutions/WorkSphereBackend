import { Types } from 'mongoose';
import CompanyMember from '../invitations/company-member.model';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SelectorItem {
    id: string;
    name: string;
    email: string;
}

export interface SelectorResult {
    data: SelectorItem[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// ─── Shared query shape ────────────────────────────────────────────────────────

export interface SelectorQuery {
    page?: number;
    limit?: number;
    search?: string;
}

// ─── ProjectSelectorService ────────────────────────────────────────────────────

export class ProjectSelectorService {

    /**
     * Internal method — fetches active members of a specific type for a company.
     * Returns minimal fields: id, name, email.
     * Used by the three selector endpoints (employees, managers, clients).
     */
    private static async fetchByType(
        companyId: string,
        memberType: 'EMPLOYEE' | 'MANAGER' | 'CLIENT' | ('EMPLOYEE' | 'MANAGER' | 'CLIENT')[],
        query: SelectorQuery
    ): Promise<SelectorResult> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(200, Math.max(1, query.limit ?? 50));
        const skip = (page - 1) * limit;

        // Build aggregation pipeline: join CompanyMember → User, filter, project
        const matchStage: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            memberType: Array.isArray(memberType) ? { $in: memberType } : memberType,
            status: 'ACTIVE',
        };

        const pipeline: any[] = [
            { $match: matchStage },
            // Join User document
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: '$user' },
            // Only keep active, non-deactivated users
            {
                $match: {
                    'user.isActive': true,
                    'user.status': { $ne: 'DEACTIVATED' },
                },
            },
        ];

        // Optional name/email search
        if (query.search?.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { 'user.name': { $regex: regex } },
                        { 'user.email': { $regex: regex } },
                    ],
                },
            });
        }

        // Project only what's needed
        pipeline.push({
            $project: {
                _id: 0,
                id: { $toString: '$userId' },
                name: '$user.name',
                email: '$user.email',
            },
        });

        // Paginate using $facet
        pipeline.push({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [
                    { $sort: { name: 1 } },
                    { $skip: skip },
                    { $limit: limit },
                ],
            },
        });

        const [result] = await CompanyMember.aggregate(pipeline);
        const total = result?.metadata?.[0]?.total ?? 0;

        return {
            data: result?.data ?? [],
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ─── Public selectors ─────────────────────────────────────────────────────

    /**
     * GET /api/v1/company/projects/selectors/employees
     * Returns all active EMPLOYEE members of the company.
     */
    static async getEmployeeSelector(companyId: string, query: SelectorQuery): Promise<SelectorResult> {
        return ProjectSelectorService.fetchByType(companyId, 'EMPLOYEE', query);
    }

    /**
     * GET /api/v1/company/projects/selectors/managers
     * Returns all active MANAGER members of the company.
     */
    static async getManagerSelector(companyId: string, query: SelectorQuery): Promise<SelectorResult> {
        return ProjectSelectorService.fetchByType(companyId, 'MANAGER', query);
    }

    /**
     * GET /api/v1/company/projects/selectors/clients
     * Returns all active CLIENT members of the company.
     */
    static async getClientSelector(companyId: string, query: SelectorQuery): Promise<SelectorResult> {
        return ProjectSelectorService.fetchByType(companyId, 'CLIENT', query);
    }

    /**
     * GET /api/v1/company/projects/selectors/members
     * Returns all active assignable company members (EMPLOYEE and MANAGER).
     */
    static async getMemberSelector(companyId: string, query: SelectorQuery): Promise<SelectorResult> {
        return ProjectSelectorService.fetchByType(companyId, ['EMPLOYEE', 'MANAGER'], query);
    }
}
