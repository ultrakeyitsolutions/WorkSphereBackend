import { Types } from 'mongoose';
import { Company } from '../../super-admin/companies/company.model';
import { AppError } from '../../../utils/AppError';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

export interface UpdateCompanyProfileDto {
    name?: string;
    companyEmail?: string;
    companyPhone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    timezone?: string;
    currency?: string;
    industry?: string;
    size?: 'STARTUP' | 'SME' | 'ENTERPRISE';
    logoUrl?: string;
}

export class CompanyProfileService {
    /**
     * Get company profile details for the authenticated company admin.
     */
    static async getProfile(companyId: string) {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid or missing company context');
        }

        const company = await Company.findById(companyId)
            .populate('adminId', 'name email')
            .lean();

        if (!company) {
            throw AppError.notFound('Company not found');
        }

        const admin = company.adminId as any;

        return {
            id: String(company._id),
            name: company.name,
            slug: company.slug,
            domain: company.domain || null,
            industry: company.industry || null,
            size: company.size || null,
            logoUrl: company.logoUrl || null,
            companyEmail: company.companyEmail || null,
            companyPhone: company.companyPhone || null,
            website: company.website || null,
            address: company.address || null,
            city: company.city || null,
            state: company.state || null,
            country: company.country || null,
            postalCode: company.postalCode || null,
            timezone: company.timezone || null,
            currency: company.currency || null,
            status: company.status,
            isActive: company.isActive,
            admin: admin && admin._id
                ? {
                    id: String(admin._id),
                    name: admin.name,
                    email: admin.email,
                }
                : null,
            createdAt: (company as any).createdAt,
            updatedAt: (company as any).updatedAt,
        };
    }

    /**
     * Update company profile details.
     */
    static async updateProfile(
        companyId: string,
        dto: UpdateCompanyProfileDto,
        actorId: string,
        actorEmail: string,
        actorRole: string
    ) {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid or missing company context');
        }

        const company = await Company.findById(companyId);
        if (!company) {
            throw AppError.notFound('Company not found');
        }

        // Check companyEmail uniqueness if it's being changed
        if (dto.companyEmail && dto.companyEmail.trim().toLowerCase() !== company.companyEmail?.toLowerCase()) {
            const conflict = await Company.findOne({
                _id: { $ne: new Types.ObjectId(companyId) },
                companyEmail: dto.companyEmail.trim().toLowerCase(),
            });
            if (conflict) {
                throw AppError.conflict('A company with this email already exists');
            }
        }

        if (dto.name !== undefined && dto.name.trim()) company.name = dto.name.trim();
        if (dto.companyEmail !== undefined) company.companyEmail = dto.companyEmail?.trim().toLowerCase() || undefined;
        if (dto.companyPhone !== undefined) company.companyPhone = dto.companyPhone?.trim() || undefined;
        if (dto.website !== undefined) company.website = dto.website?.trim() || undefined;
        if (dto.address !== undefined) company.address = dto.address?.trim() || undefined;
        if (dto.city !== undefined) company.city = dto.city?.trim() || undefined;
        if (dto.state !== undefined) company.state = dto.state?.trim() || undefined;
        if (dto.country !== undefined) company.country = dto.country?.trim() || undefined;
        if (dto.postalCode !== undefined) company.postalCode = dto.postalCode?.trim() || undefined;
        if (dto.timezone !== undefined) company.timezone = dto.timezone?.trim() || undefined;
        if (dto.currency !== undefined) company.currency = dto.currency?.trim() || undefined;
        if (dto.industry !== undefined) company.industry = dto.industry?.trim() || undefined;
        if (dto.size !== undefined) company.size = dto.size;
        if (dto.logoUrl !== undefined) company.logoUrl = dto.logoUrl?.trim() || undefined;

        await company.save();

        await AuditLogService.log({
            action: AuditAction.COMPANY_UPDATED,
            actorId,
            actorEmail,
            actorRole,
            companyId,
            companyName: company.name,
            success: true,
            description: `Company profile updated: ${company.name}`,
        });

        return this.getProfile(companyId);
    }
}
