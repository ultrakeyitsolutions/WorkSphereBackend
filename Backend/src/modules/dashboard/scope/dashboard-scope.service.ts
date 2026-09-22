import { Types } from 'mongoose';
import { TokenPayload } from '../../../utils/tokens';
import { AppError } from '../../../utils/AppError';
import { Company } from '../../super-admin/companies/company.model';
import { User } from '../../users/user.model';
import { UserService } from '../../users/user.service';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { DashboardQueryDto, DashboardScopeContext, DashboardScopeType } from '../dashboard.types';
import { DashboardDateRangeService } from '../services/dashboard-date-range.service';

export class DashboardScopeService {
    /**
     * Resolves the complete normalized dashboard scope for the authenticated user.
     */
    public static async resolveScope(
        requester: TokenPayload,
        query: DashboardQueryDto,
        impersonatedCompanyId?: string
    ): Promise<DashboardScopeContext> {
        // 1. Resolve Company ID
        let companyIdStr: string | undefined = requester.companyId;

        if (requester.role === 'SUPER_ADMIN' && impersonatedCompanyId) {
            if (!Types.ObjectId.isValid(impersonatedCompanyId)) {
                throw AppError.badRequest('Invalid target company ID');
            }
            const targetCompany = await Company.findById(impersonatedCompanyId).lean();
            if (!targetCompany) {
                throw AppError.notFound('Target organization not found');
            }
            companyIdStr = impersonatedCompanyId;
        }

        if (!companyIdStr || !Types.ObjectId.isValid(companyIdStr)) {
            throw AppError.unauthorized('Unauthorized: Valid company context is required');
        }

        const companyId = new Types.ObjectId(companyIdStr);
        const userId = new Types.ObjectId(requester.userId);

        // 2. Fetch User & Company Docs for Timezone and Role Validation
        const [companyDoc, userDoc] = await Promise.all([
            Company.findById(companyId).select('timezone').lean(),
            User.findById(userId).select('timezone grantedPermissions revokedPermissions role').populate('role', 'name').lean(),
        ]);

        if (!userDoc) {
            throw AppError.unauthorized('User context not found');
        }

        const roleObj = (userDoc as any).role;
        const roleName = (typeof roleObj === 'string' ? roleObj : roleObj?.name || requester.role || '').toUpperCase();

        const isCompanyWide = roleName === 'COMPANY_ADMIN' || roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';
        const scopeType: DashboardScopeType = isCompanyWide ? 'COMPANY' : 'PROJECTS';

        // 3. Resolve Accessible Project IDs
        let accessibleProjectIds: Types.ObjectId[] = [];

        if (isCompanyWide) {
            // Company Admin can see all active company projects
            const allProjects = await Project.find({
                companyId,
                deletedAt: null,
            }).select('_id').lean();
            accessibleProjectIds = allProjects.map((p) => p._id as Types.ObjectId);
        } else {
            // Employee / Member: ONLY projects they are explicitly assigned to or in charge of
            const [teamMemberships, inCharges, createdProjects] = await Promise.all([
                ProjectTeamMember.find({ userId }).select('projectId').lean(),
                ProjectInCharge.find({ userId }).select('projectId').lean(),
                Project.find({ companyId, createdById: userId, deletedAt: null }).select('_id').lean(),
            ]);

            const pIdSet = new Set<string>();
            teamMemberships.forEach((m) => pIdSet.add(String(m.projectId)));
            inCharges.forEach((m) => pIdSet.add(String(m.projectId)));
            createdProjects.forEach((p) => pIdSet.add(String(p._id)));

            accessibleProjectIds = Array.from(pIdSet).map((id) => new Types.ObjectId(id));
        }

        // 4. Validate & Apply Filters
        let filterProjectId: Types.ObjectId | undefined;
        if (query.projectId && Types.ObjectId.isValid(query.projectId)) {
            const requestedPId = new Types.ObjectId(query.projectId);

            if (!isCompanyWide) {
                // For employee: Must verify project is in their authorized accessible list
                const hasAccess = accessibleProjectIds.some((pId) => pId.equals(requestedPId));
                if (!hasAccess) {
                    throw AppError.forbidden('UNAUTHORIZED_PROJECT_ACCESS');
                }
            }
            filterProjectId = requestedPId;
        }

        let filterTeamId: Types.ObjectId | undefined;
        if (query.teamId && Types.ObjectId.isValid(query.teamId)) {
            if (isCompanyWide) {
                filterTeamId = new Types.ObjectId(query.teamId);
            } else {
                // Employees are strictly restricted to themselves; cannot inspect other team members
                filterTeamId = userId;
            }
        }

        // 5. Resolve Permissions
        let hasLiveMonitoring = false;
        let hasUserReview = false;

        if (isCompanyWide) {
            [hasLiveMonitoring, hasUserReview] = await Promise.all([
                UserService.hasPermission(requester.userId, 'LIVE_MONITORING_READ'),
                UserService.hasPermission(requester.userId, 'USER_REVIEW_READ'),
            ]);
        }

        // 6. Resolve Timezone and Date Range
        const companyTimezone = (companyDoc as any)?.timezone || null;
        const userTimezone = (userDoc as any)?.timezone || null;
        const dateRange = DashboardDateRangeService.resolve(query, companyTimezone, userTimezone);

        return {
            companyId,
            userId,
            roleName,
            scopeType,
            isCompanyWide,
            accessibleProjectIds,
            hasLiveMonitoring,
            hasUserReview,
            dateRange,
            filterProjectId,
            filterTeamId,
        };
    }
}
