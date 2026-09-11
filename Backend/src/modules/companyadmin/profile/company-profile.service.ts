import { Types } from 'mongoose';
import { Company } from '../../super-admin/companies/company.model';
import { Subscription } from '../../super-admin/subscriptions/subscription.model';
import { SubscriptionStatus } from '../../super-admin/subscriptions/subscription.types';
import { Plan } from '../../super-admin/plans/plans.model';
import { PlanUpgradeRequest } from '../../super-admin/subscriptions/plan-upgrade-request.model';
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

export interface RequestPlanUpgradeDto {
    targetPlanId: string;
    billingCycle?: string;
    message?: string;
}

export class CompanyProfileService {
    /**
     * Helper to get formatted subscription and plan for a company.
     */
    static async getCompanySubscription(companyId: string) {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return null;

        const sub: any = await Subscription.findOne({
            companyId: new Types.ObjectId(companyId),
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED, SubscriptionStatus.PENDING] },
        })
            .sort({ createdAt: -1 })
            .populate('planId')
            .lean();

        if (sub && sub.planId) {
            const plan = sub.planId;
            return {
                id: String(sub._id),
                status: sub.status,
                startedAt: sub.startedAt,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
                plan: {
                    id: String(plan._id),
                    name: plan.name,
                    code: plan.code,
                    description: plan.description,
                    billingCycle: plan.billingCycle,
                    price: plan.price,
                    currency: plan.currency,
                    trialPeriodDays: plan.trialPeriodDays ?? 0,
                },
            };
        }

        // Fallback to default/free plan if no subscription record has been created yet
        const defaultPlan: any = await Plan.findOne({ isDefault: true, isActive: true, isArchived: false }).lean();
        if (defaultPlan) {
            return {
                id: null,
                status: 'ACTIVE',
                startedAt: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                plan: {
                    id: String(defaultPlan._id),
                    name: defaultPlan.name,
                    code: defaultPlan.code,
                    description: defaultPlan.description,
                    billingCycle: defaultPlan.billingCycle,
                    price: defaultPlan.price,
                    currency: defaultPlan.currency,
                    trialPeriodDays: defaultPlan.trialPeriodDays ?? 0,
                },
            };
        }

        return null;
    }

    /**
     * Get company profile details for the authenticated company admin.
     */
    static async getProfile(companyId: string) {
        if (!companyId || !Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid or missing company context');
        }

        const [company, subscription] = await Promise.all([
            Company.findById(companyId).populate('adminId', 'name email').lean(),
            this.getCompanySubscription(companyId),
        ]);

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
            subscription,
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

    /**
     * Get list of all available plans for upgrade.
     */
    static async getAvailablePlans() {
        const plans = await Plan.find({ isActive: true, isArchived: false }).sort({ price: 1 }).lean();
        return plans.map((p) => ({
            id: String(p._id),
            name: p.name,
            code: p.code,
            description: p.description,
            billingCycle: p.billingCycle,
            price: p.price,
            currency: p.currency,
            trialPeriodDays: p.trialPeriodDays ?? 0,
            isDefault: p.isDefault,
        }));
    }

    /**
     * Submit a plan upgrade request to Superadmin.
     */
    static async createUpgradeRequest(
        companyId: string,
        requestedById: string,
        dto: RequestPlanUpgradeDto,
        actorEmail: string,
        actorRole: string
    ) {
        if (!dto.targetPlanId || !Types.ObjectId.isValid(dto.targetPlanId)) {
            throw AppError.badRequest('Valid targetPlanId is required');
        }

        const targetPlan = await Plan.findOne({ _id: new Types.ObjectId(dto.targetPlanId), isActive: true, isArchived: false });
        if (!targetPlan) {
            throw AppError.notFound('Target plan not found or inactive');
        }

        // Get current subscription plan
        const currentSub: any = await Subscription.findOne({
            companyId: new Types.ObjectId(companyId),
            status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED] },
        }).sort({ createdAt: -1 });

        const currentPlanId = currentSub?.planId || undefined;

        // Check if there is already a pending upgrade request for this company
        const existingPending = await PlanUpgradeRequest.findOne({
            companyId: new Types.ObjectId(companyId),
            status: 'PENDING',
        });
        if (existingPending) {
            throw AppError.conflict('You already have a pending plan upgrade request under review by Superadmin');
        }

        const request = await PlanUpgradeRequest.create({
            companyId: new Types.ObjectId(companyId),
            requestedById: new Types.ObjectId(requestedById),
            currentPlanId,
            targetPlanId: targetPlan._id,
            billingCycle: dto.billingCycle || targetPlan.billingCycle,
            message: dto.message?.trim(),
            status: 'PENDING',
        });

        const company = await Company.findById(companyId).select('name');

        await AuditLogService.log({
            action: AuditAction.OTHER,
            actorId: requestedById,
            actorEmail,
            actorRole,
            companyId,
            companyName: company?.name,
            success: true,
            description: `Requested plan upgrade to "${targetPlan.name}" for ${company?.name || 'company'}`,
            metadata: {
                targetPlanId: String(targetPlan._id),
                targetPlanName: targetPlan.name,
                billingCycle: dto.billingCycle || targetPlan.billingCycle,
            },
        });

        return {
            id: String(request._id),
            status: request.status,
            targetPlan: {
                id: String(targetPlan._id),
                name: targetPlan.name,
                code: targetPlan.code,
                price: targetPlan.price,
                currency: targetPlan.currency,
                billingCycle: targetPlan.billingCycle,
            },
            billingCycle: request.billingCycle,
            message: request.message || null,
            createdAt: request.createdAt,
        };
    }

    /**
     * Get all upgrade requests for this company.
     */
    static async getUpgradeRequests(companyId: string) {
        const requests = await PlanUpgradeRequest.find({ companyId: new Types.ObjectId(companyId) })
            .sort({ createdAt: -1 })
            .populate('currentPlanId', 'name code price currency billingCycle')
            .populate('targetPlanId', 'name code price currency billingCycle')
            .populate('requestedById', 'name email')
            .lean();

        return requests.map((r: any) => ({
            id: String(r._id),
            status: r.status,
            currentPlan: r.currentPlanId
                ? {
                    id: String(r.currentPlanId._id),
                    name: r.currentPlanId.name,
                    code: r.currentPlanId.code,
                    price: r.currentPlanId.price,
                    currency: r.currentPlanId.currency,
                    billingCycle: r.currentPlanId.billingCycle,
                }
                : null,
            targetPlan: {
                id: String(r.targetPlanId._id),
                name: r.targetPlanId.name,
                code: r.targetPlanId.code,
                price: r.targetPlanId.price,
                currency: r.targetPlanId.currency,
                billingCycle: r.targetPlanId.billingCycle,
            },
            billingCycle: r.billingCycle,
            message: r.message || null,
            rejectionReason: r.rejectionReason || null,
            reviewedAt: r.reviewedAt || null,
            createdAt: r.createdAt,
        }));
    }
}
