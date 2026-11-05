import { Types } from 'mongoose';
import CompanyMember from '../invitations/company-member.model';
import { AppError } from '../../../utils/AppError';

export interface ResolvedMember {
    member: any;
    userId: string;
    memberId: string;
    companyId: string;
}

/**
 * Centralized member resolution for the authenticated organization.
 * Resolves an identifier to the active CompanyMember membership record.
 *
 * The identifier may be either:
 *   - the User's _id (userId) — used by the role API (/api/v1/company/users/:userId/role)
 *   - the CompanyMember document _id (memberId) — used by module-access APIs
 *
 * Both identifiers resolve to the same active membership. Active membership
 * validation is always enforced; a missing or inactive membership throws.
 */
export class MemberResolutionService {
    static async resolveActiveMember(
        companyId: string,
        identifier: string
    ): Promise<ResolvedMember> {
        if (!companyId) {
            throw AppError.badRequest('Company context is required');
        }
        if (!identifier) {
            throw AppError.badRequest('Member identifier is required');
        }

        const compId = new Types.ObjectId(companyId);

        // 1. Try as User _id (userId) — the role API passes this
        let member = await CompanyMember.findOne({
            companyId: compId,
            userId: identifier,
        }).lean();

        // 2. Try as CompanyMember _id (memberId) — module-access APIs may pass this
        if (!member && Types.ObjectId.isValid(identifier)) {
            member = await CompanyMember.findOne({
                companyId: compId,
                _id: new Types.ObjectId(identifier),
            }).lean();
        }

        if (!member) {
            throw AppError.notFound('User is not an active member of this company');
        }

        const user = (member as any).userId;
        const userId = String(user?._id || user || member.userId);
        const memberId = String(member._id);

        return {
            member,
            userId,
            memberId,
            companyId: String(companyId),
        };
    }
}
