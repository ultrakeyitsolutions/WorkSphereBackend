import mongoose from 'mongoose';
import { Company } from './company.model';
import { User } from '../../users/user.model';
import { Role } from '../../roles/role.model';
import { hashPassword } from '../../../utils/password';
import { CreateCompanyDto } from './company.schema';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a company name to a URL-safe slug.
 * e.g. "Acme Corp!" → "acme-corp"
 */
const toSlug = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

// ─── Company Service ──────────────────────────────────────────────────────────
export class CompanyService {
    /**
     * Creates a Company and its initial COMPANY_ADMIN user inside a single
     * MongoDB session (atomic transaction).
     *
     * Flow:
     *  BEGIN TRANSACTION
     *    1. Resolve / create the "COMPANY_ADMIN" Role
     *    2. Create the Company document
     *    3. Create the admin User with companyId + COMPANY_ADMIN role
     *    4. Back-patch company.adminId → the new User's _id
     *  COMMIT
     *
     * @param dto - Validated CreateCompanyDto from the controller
     * @returns   - { company, admin } without the hashed password
     */
    static async createWithAdmin(dto: CreateCompanyDto, actorUserId?: string) {
        // ── Guard: duplicate email check (outside tx — fast fail) ────────────
        const existingUser = await User.findOne({ email: dto.adminEmail.toLowerCase() });
        if (existingUser) {
            throw new Error(`A user with email "${dto.adminEmail}" already exists`);
        }

        // ── Guard: duplicate company slug check ──────────────────────────────
        const slug = toSlug(dto.companyName);
        const existingCompany = await Company.findOne({ slug });
        if (existingCompany) {
            throw new Error(`A company with the name "${dto.companyName}" already exists`);
        }

        // ── Open MongoDB session & start transaction ─────────────────────────
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Step 1 ── Resolve or create the COMPANY_ADMIN role ───────────────
            let companyAdminRole = await Role.findOne({ name: 'COMPANY_ADMIN' }).session(session);
            if (!companyAdminRole) {
                const [created] = await Role.create(
                    [{ name: 'COMPANY_ADMIN', permissions: [] }],
                    { session }
                );
                companyAdminRole = created;
            }

            // Step 2 ── Create the Company (adminId is null at first) ───────────
            const [company] = await Company.create(
                [
                    {
                        name: dto.companyName,
                        slug,
                        domain: dto.companyDomain,
                        industry: dto.companyIndustry,
                        size: dto.companySize,
                        status: 'ACTIVE',
                        isActive: true,
                    },
                ],
                { session }
            );

            // Step 3 ── Create the Admin User linked to the Company ─────────────
            const hashedPassword = await hashPassword(dto.adminPassword);

            const adminUser = new User({
                name: dto.adminName,
                email: dto.adminEmail.toLowerCase(),
                password: hashedPassword,
                role: companyAdminRole._id,
                companyId: company._id,
                isActive: true,
                status: 'ACTIVE',
            });
            const admin = await adminUser.save({ session });

            // Step 4 ── Back-patch company.adminId ────────────────────────────────
            company.adminId = admin._id as any;
            await company.save({ session });

            // ── COMMIT ────────────────────────────────────────────────────────
            await session.commitTransaction();

            // ── Audit log the company creation ────────────────────────────────
            await AuditLogService.log({
                action: AuditAction.COMPANY_CREATED,
                actorId: actorUserId ?? null,
                companyId: String(company._id),
                companyName: company.name,
                targetUserId: String(admin._id),
                targetEmail: admin.email,
                success: true,
                description: `Company "${company.name}" created with admin: ${admin.email}`,
            });

            return {
                company: {
                    id: company._id,
                    name: company.name,
                    slug: company.slug,
                    domain: company.domain,
                    industry: company.industry,
                    size: company.size,
                    status: company.status,
                    createdAt: company.createdAt,
                },
                admin: {
                    id: admin._id,
                    name: admin.name,
                    email: admin.email,
                    role: 'COMPANY_ADMIN',
                    companyId: company._id,
                },
            };
        } catch (error) {
            // ── ROLLBACK on any failure ───────────────────────────────────────
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Fetch a single company by its ObjectId. Excludes DELETED companies.
     */
    static async findById(id: string) {
        return Company.findOne({ _id: id, status: { $ne: 'DELETED' } }).populate('adminId', 'name email');
    }

    /**
     * Fetch all companies. Excludes DELETED companies.
     */
    static async findAll() {
        return Company.find({ status: { $ne: 'DELETED' } }).sort({ createdAt: -1 }).populate('adminId', 'name email');
    }

    /**
     * Edits Company profile details.
     */
    static async editCompany(companyId: string, data: any) {
        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
        if (!company) {
            throw new Error('Company not found');
        }

        if (data.companyEmail) {
            const existingEmailCompany = await Company.findOne({
                companyEmail: data.companyEmail.toLowerCase(),
                _id: { $ne: companyId },
                status: { $ne: 'DELETED' }
            });
            if (existingEmailCompany) {
                const err = new Error('Email is already registered by another company') as any;
                err.code = 11000; // Simulate Mongo duplicate key error to be mapped to 409
                throw err;
            }
        }

        if (data.companyName !== undefined) company.name = data.companyName;
        if (data.industry !== undefined) company.industry = data.industry;
        if (data.companyEmail !== undefined) company.companyEmail = data.companyEmail.toLowerCase();
        if (data.companyPhone !== undefined) company.companyPhone = data.companyPhone;
        if (data.website !== undefined) company.website = data.website;
        if (data.address !== undefined) company.address = data.address;
        if (data.city !== undefined) company.city = data.city;
        if (data.state !== undefined) company.state = data.state;
        if (data.country !== undefined) company.country = data.country;
        if (data.postalCode !== undefined) company.postalCode = data.postalCode;
        if (data.timezone !== undefined) company.timezone = data.timezone;
        if (data.currency !== undefined) company.currency = data.currency;

        await company.save();
        return company;
    }

    /**
     * Suspends a Company.
     */
    static async suspendCompany(companyId: string, reason: string | undefined, actorUserId: string) {
        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
        if (!company) {
            throw new Error('Company not found');
        }

        if (company.status === 'SUSPENDED') {
            return company; // Idempotent
        }

        company.status = 'SUSPENDED';
        company.isActive = false;
        company.suspendedAt = new Date();
        company.suspendedBy = actorUserId as any;
        company.suspensionReason = reason;

        await company.save();

        await AuditLogService.log({
            action: AuditAction.COMPANY_SUSPENDED,
            actorId: actorUserId,
            companyId: companyId,
            companyName: company.name,
            success: true,
            description: `Company "${company.name}" suspended. Reason: ${reason ?? 'None'}`,
            metadata: { reason },
        });

        return company;
    }

    /**
     * Activates a suspended Company.
     */
    static async activateCompany(companyId: string, actorUserId: string) {
        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
        if (!company) {
            throw new Error('Company not found');
        }

        if (company.status === 'ACTIVE') {
            return company; // Idempotent
        }

        company.status = 'ACTIVE';
        company.isActive = true;
        company.activatedAt = new Date();
        company.activatedBy = actorUserId as any;

        // Clear suspension trail
        company.suspendedAt = undefined;
        company.suspendedBy = undefined;
        company.suspensionReason = undefined;

        await company.save();

        await AuditLogService.log({
            action: AuditAction.COMPANY_ACTIVATED,
            actorId: actorUserId,
            companyId: companyId,
            companyName: company.name,
            success: true,
            description: `Company "${company.name}" re-activated`,
        });

        return company;
    }

    /**
     * Soft deletes a Company.
     */
    static async deleteCompany(companyId: string, actorUserId: string) {
        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
        if (!company) {
            throw new Error('Company not found');
        }

        company.status = 'DELETED';
        company.isActive = false;
        company.deletedAt = new Date();
        company.deletedBy = actorUserId as any;

        await company.save();

        await AuditLogService.log({
            action: AuditAction.COMPANY_DELETED,
            actorId: actorUserId,
            companyId: companyId,
            companyName: company.name,
            success: true,
            description: `Company "${company.name}" soft-deleted`,
        });

        return company;
    }

    /**
     * Resets the password of the Company's COMPANY_ADMIN.
     */
    static async resetCompanyAdminPassword(companyId: string, data: any, actorUserId: string) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } }).session(session);
            if (!company) {
                throw new Error('Company not found');
            }

            const adminRole = await Role.findOne({ name: 'COMPANY_ADMIN' }).session(session);
            if (!adminRole) {
                throw new Error('Role COMPANY_ADMIN not found');
            }

            const adminUser = await User.findOne({
                companyId: company._id,
                role: adminRole._id
            } as any).session(session);

            if (!adminUser) {
                throw new Error('Company Admin not found for this company');
            }

            if (!data.password) {
                throw new Error('Password is required for reset');
            }

            const hashedPassword = await hashPassword(data.password);
            adminUser.password = hashedPassword;
            adminUser.mustChangePassword = true;

            await adminUser.save({ session });
            await session.commitTransaction();

            await AuditLogService.log({
                action: AuditAction.PASSWORD_RESET,
                actorId: actorUserId,
                companyId: companyId,
                companyName: company.name,
                targetUserId: String(adminUser._id),
                targetEmail: adminUser.email,
                success: true,
                description: `Password force-reset for company admin: ${adminUser.email} by super-admin`,
            });

            return { success: true };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Fetch comprehensive details for a company: Profile, Admin, Subscription (with Plan), and Subscription History (Events).
     */
    static async getFullDetails(companyId: string) {
        const company = await Company.findOne({ _id: companyId }).populate('adminId', 'name email createdAt updatedAt role mustChangePassword status');
        if (!company) {
            throw new Error('Company not found');
        }

        // dynamically load resolving circular dep
        const Subscription = mongoose.model('Subscription');
        const SubscriptionEvent = mongoose.model('SubscriptionEvent');

        const subscription = await Subscription.findOne({ companyId }).populate('planId');

        const subscriptionEvents = await SubscriptionEvent.find({ companyId })
            .sort({ createdAt: -1 })
            .populate('fromPlanId', 'name price billingCycle')
            .populate('toPlanId', 'name price billingCycle')
            .populate('performedBy', 'name email');

        return {
            company,
            subscription,
            subscriptionEvents
        };
    }
}
