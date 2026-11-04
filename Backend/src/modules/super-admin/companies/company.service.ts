import crypto from 'crypto';
import mongoose from 'mongoose';
import { Company } from './company.model';
import { User } from '../../users/user.model';
import { Role } from '../../roles/role.model';
import { hashPassword } from '../../../utils/password';
import { CreateCompanyDto } from './company.schema';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { StorageConfigurationService } from '../storage/storage-config.service';
import { StorageProviderFactory } from '../../../infrastructure/storage/storage-provider.factory';
import { CloudinaryStorageProvider } from '../../../infrastructure/storage/providers/cloudinary-storage.provider';
import { SessionService } from '../../auth/session/session.service';
import { getRedisClient } from '../../../config/redis';
import { getSocketServer } from '../../../sockets/socket-server';
import { SuperAdminNotificationService } from '../notifications/super-admin-notification.service';
import {
    WhiteLabelSettings,
    DEFAULT_WHITE_LABEL_THEME,
    DEFAULT_WHITE_LABEL_LOGIN,
} from '../white-label/white-label.model';
import { TenantMembership } from '../white-label/tenant-membership.model';
import { WhiteLabelService } from '../white-label/white-label.service';
import { Subscription } from '../subscriptions/subscription.model';
import { Plan } from '../plans/plans.model';
import { SubscriptionStatus } from '../subscriptions/subscription.types';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { CompanySettings } from '../../companyadmin/settings/company-settings.model';
import { getMailTransporter, mailDefaults } from '../../../config/mail';

export const ALLOWED_LOGO_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
]);
export const ALLOWED_LOGO_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
export const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── Idempotency Cache ────────────────────────────────────────────────────────
interface IdempotencyRecord {
    result?: any;
    error?: any;
    inFlight?: Promise<any>;
    expiresAt: number;
}
const companyCreationIdempotencyMap = new Map<string, IdempotencyRecord>();
const IDEMPOTENCY_TTL_MS = 120 * 1000; // 2 minutes

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
     * Creates a Company, WhiteLabel configuration, Subscription, and COMPANY_ADMIN user
     * inside a single MongoDB atomic transaction with idempotency protection.
     *
     * Flow:
     *  1. Idempotency guard (in-memory + lock)
     *  2. Fast-fail uniqueness guards (email, slug, custom domain)
     *  BEGIN TRANSACTION
     *    3. Resolve / create COMPANY_ADMIN role
     *    4. Generate system tenantId (ws_comp_...)
     *    5. Create Company document
     *    6. Create admin User with companyId + COMPANY_ADMIN role
     *    7. Back-patch company.adminId
     *    8. Create WhiteLabelSettings document
     *    9. Create TenantMembership document
     *    10. Assign Subscription plan if requested or active default
     *    11. Initialize CompanySettings
     *  COMMIT
     *  12. Post-commit: invalidate caches, audit log, notifications, welcome email
     */
    static async createWithAdmin(
        dto: CreateCompanyDto,
        actorUserId?: string,
        idempotencyKey?: string
    ) {
        // ── 1. Idempotency Protection ─────────────────────────────────────────
        const normalizedKey = idempotencyKey?.trim() || `${dto.adminEmail.toLowerCase()}_${toSlug(dto.companyName)}`;
        const existingRecord = companyCreationIdempotencyMap.get(normalizedKey);

        if (existingRecord && existingRecord.expiresAt > Date.now()) {
            if (existingRecord.inFlight) {
                return await existingRecord.inFlight;
            }
            if (existingRecord.result) {
                return existingRecord.result;
            }
        }

        const executionPromise = (async () => {
            // ── 2. Guard: duplicate email check (fast fail) ────────────────────
            const existingUser = await User.findOne({ email: dto.adminEmail.toLowerCase() });
            if (existingUser) {
                throw new Error(`A user with email "${dto.adminEmail}" already exists`);
            }

            // ── Guard: duplicate company slug check ────────────────────────────
            const slug = (dto.slug?.trim() || toSlug(dto.companyName)).toLowerCase();
            const existingCompany = await Company.findOne({ slug });
            if (existingCompany) {
                throw new Error(`A company with the name "${dto.companyName}" already exists`);
            }

            // ── Guard: custom domain uniqueness check ──────────────────────────
            const customDomain = (dto.customDomain || dto.whiteLabel?.customDomain || dto.companyDomain)?.toLowerCase().trim();
            if (customDomain) {
                const existingDomain = await WhiteLabelSettings.findOne({
                    customDomain,
                    domainVerificationStatus: 'VERIFIED',
                });
                if (existingDomain) {
                    throw new Error(`The custom domain "${customDomain}" is already registered to another company`);
                }
            }

            // ── Open MongoDB session & start transaction ───────────────────────
            const session = await mongoose.startSession();
            let transactionCommitted = false;

            try {
                session.startTransaction();

                // Step 1 ── Resolve or create the COMPANY_ADMIN role ─────────────
                let companyAdminRole = await Role.findOne({ name: 'COMPANY_ADMIN' }).session(session);
                if (!companyAdminRole) {
                    const [created] = await Role.create(
                        [{ name: 'COMPANY_ADMIN', permissions: [] }],
                        { session }
                    );
                    companyAdminRole = created;
                }

                // Step 2 ── Generate unique system tenantId ─────────────────────
                const tenantId = dto.tenantId?.trim() || `ws_comp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

                // Step 3 ── Create the Company document ─────────────────────────
                const [company] = await Company.create(
                    [
                        {
                            tenantId,
                            name: dto.companyName,
                            slug,
                            domain: customDomain || undefined,
                            industry: dto.companyIndustry,
                            size: dto.companySize,
                            logoUrl: dto.logoUrl ? dto.logoUrl.trim() : undefined,
                            companyEmail: dto.companyEmail?.toLowerCase().trim(),
                            companyPhone: dto.companyPhone?.trim() || dto.contactNumber?.trim(),
                            website: dto.website?.trim(),
                            address: dto.address?.trim(),
                            city: dto.city?.trim(),
                            state: dto.state?.trim(),
                            country: dto.country?.trim(),
                            postalCode: dto.postalCode?.trim(),
                            timezone: dto.timezone?.trim(),
                            currency: dto.currency?.trim(),
                            status: dto.status || 'ACTIVE',
                            isActive: dto.status ? dto.status === 'ACTIVE' : true,
                        },
                    ],
                    { session }
                );

                // Step 4 ── Create Admin User linked to Company ──────────────────
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

                // Step 5 ── Back-patch company.adminId ──────────────────────────
                company.adminId = admin._id as any;

                // Step 6 ── Initialize White-Label Settings ─────────────────────
                const whiteLabelEnabled = Boolean(dto.whiteLabelEnabled ?? dto.whiteLabel?.enabled);
                const displayName = dto.displayName || dto.whiteLabel?.displayName || company.name;
                const faviconUrl = dto.faviconUrl || dto.whiteLabel?.faviconUrl || null;
                const appTitle = dto.appTitle || dto.whiteLabel?.appTitle || company.name;

                const primaryColor = dto.primaryColor || dto.whiteLabel?.primaryColor || DEFAULT_WHITE_LABEL_THEME.primaryColor;
                const secondaryColor = dto.secondaryColor || dto.whiteLabel?.secondaryColor || DEFAULT_WHITE_LABEL_THEME.secondaryColor;
                const backgroundColor = dto.backgroundColor || dto.whiteLabel?.backgroundColor || DEFAULT_WHITE_LABEL_THEME.backgroundColor;
                const textColor = dto.textColor || dto.whiteLabel?.textColor || DEFAULT_WHITE_LABEL_THEME.textColor;
                const accentColor = dto.accentColor || dto.whiteLabel?.accentColor || DEFAULT_WHITE_LABEL_THEME.accentColor;

                const [whiteLabelSettings] = await WhiteLabelSettings.create(
                    [
                        {
                            tenantId,
                            companyId: company._id,
                            enabled: whiteLabelEnabled,
                            displayName,
                            logoUrl: company.logoUrl || null,
                            faviconUrl,
                            appTitle,
                            theme: {
                                primaryColor,
                                secondaryColor,
                                backgroundColor,
                                textColor,
                                accentColor,
                                sidebarBackground: dto.whiteLabel?.sidebarBackground || DEFAULT_WHITE_LABEL_THEME.sidebarBackground,
                                sidebarText: dto.whiteLabel?.sidebarText || DEFAULT_WHITE_LABEL_THEME.sidebarText,
                            },
                            loginPage: {
                                heading: dto.whiteLabel?.loginPage?.heading || `Welcome to ${company.name}`,
                                subtitle: dto.whiteLabel?.loginPage?.subtitle || DEFAULT_WHITE_LABEL_LOGIN.subtitle,
                                bannerImageUrl: dto.whiteLabel?.loginPage?.bannerImageUrl || null,
                                backgroundImageUrl: dto.whiteLabel?.loginPage?.backgroundImageUrl || null,
                                hideWorkSphereBranding: Boolean(dto.whiteLabel?.loginPage?.hideWorkSphereBranding),
                                customCss: dto.whiteLabel?.loginPage?.customCss || null,
                            },
                            customDomain: customDomain || null,
                            domainVerificationStatus: customDomain ? 'VERIFIED' : 'NONE',
                            updatedBy: actorUserId ? (new mongoose.Types.ObjectId(actorUserId) as any) : null,
                        },
                    ],
                    { session }
                );

                // Step 7 ── Create TenantMembership ─────────────────────────────
                await TenantMembership.create(
                    [
                        {
                            tenantId,
                            companyId: company._id,
                            userId: admin._id,
                            role: 'COMPANY_ADMIN',
                            status: 'ACTIVE',
                            permissions: ['ALL'],
                            joinedAt: new Date(),
                        },
                    ],
                    { session }
                );

                // Step 8 ── Apply Subscription Plan ─────────────────────────────
                const targetPlanId = dto.planId || dto.subscriptionPlan;
                let selectedPlan: any = null;

                if (targetPlanId) {
                    if (mongoose.Types.ObjectId.isValid(targetPlanId)) {
                        selectedPlan = await Plan.findById(targetPlanId).session(session);
                    }
                    if (!selectedPlan) {
                        selectedPlan = await Plan.findOne({ code: targetPlanId.toUpperCase() }).session(session);
                    }
                }

                if (!selectedPlan) {
                    // Fallback to default active plan
                    selectedPlan = await Plan.findOne({ isActive: true, isArchived: { $ne: true } })
                        .sort({ isDefault: -1, createdAt: 1 })
                        .session(session);
                }

                if (selectedPlan) {
                    const now = new Date();
                    const periodEnd = SubscriptionService.calculatePeriodEnd(now, selectedPlan.billingCycle || 'MONTHLY');

                    const [subscription] = await Subscription.create(
                        [
                            {
                                companyId: company._id,
                                planId: selectedPlan._id,
                                status: SubscriptionStatus.ACTIVE,
                                startedAt: now,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                                cancelAtPeriodEnd: false,
                            },
                        ],
                        { session }
                    );

                    company.subscriptionId = subscription._id as any;
                }

                // Step 9 ── Initialize CompanySettings ──────────────────────────
                await CompanySettings.create(
                    [
                        {
                            companyId: company._id,
                            general: {
                                timezone: dto.timezone || 'UTC',
                                currency: dto.currency || 'USD',
                            },
                        },
                    ],
                    { session }
                );

                await company.save({ session });

                // ── COMMIT ────────────────────────────────────────────────────
                await session.commitTransaction();
                transactionCommitted = true;

                // ── Post-Commit Operations ────────────────────────────────────
                await WhiteLabelService.invalidateCache(tenantId, slug, customDomain || undefined);

                // ── Audit log the company creation ────────────────────────────
                await AuditLogService.log({
                    action: AuditAction.COMPANY_CREATED,
                    actorId: actorUserId ?? null,
                    companyId: String(company._id),
                    companyName: company.name,
                    targetUserId: String(admin._id),
                    targetEmail: admin.email,
                    success: true,
                    description: `Company "${company.name}" (Tenant: ${tenantId}) created with admin: ${admin.email}`,
                    metadata: { tenantId, slug, whiteLabelEnabled },
                });

                // ── SuperAdmin Notifications ───────────────────────────────────
                SuperAdminNotificationService.dispatch({
                    type: 'COMPANY_REGISTERED',
                    companyId: String(company._id),
                    actorId: actorUserId,
                    eventId: `comp_reg_${company._id}`,
                    metadata: {
                        tenantId,
                        companyName: company.name,
                        adminEmail: admin.email,
                        companyDomain: company.domain,
                        companySize: company.size,
                    },
                }).catch(() => {});

                SuperAdminNotificationService.dispatch({
                    type: 'COMPANY_ADMIN_CREATED',
                    companyId: String(company._id),
                    actorId: actorUserId,
                    eventId: `comp_adm_created_${admin._id}`,
                    metadata: {
                        tenantId,
                        companyName: company.name,
                        adminEmail: admin.email,
                        adminName: admin.name,
                    },
                }).catch(() => {});

                // ── Send Welcome Email to Company Admin ────────────────────────
                try {
                    const transporter = getMailTransporter();
                    const appUrl = process.env.APP_URL || 'https://worksphere.io';
                    await transporter.sendMail({
                        from: mailDefaults.from,
                        to: admin.email,
                        subject: `Welcome to WorkSphere — Your Workspace "${company.name}" is Ready`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 24px; color: #333;">
                                <h2>Welcome, ${admin.name}!</h2>
                                <p>Your organization workspace <strong>${company.name}</strong> has been successfully established on WorkSphere.</p>
                                <p><strong>Workspace Details:</strong></p>
                                <ul>
                                    <li>Tenant ID: <code>${tenantId}</code></li>
                                    <li>Workspace Slug: <code>${slug}</code></li>
                                    <li>Admin Email: <code>${admin.email}</code></li>
                                </ul>
                                <p>You can sign in to your workspace portal here: <a href="${appUrl}/login?workspace=${slug}">${appUrl}/login?workspace=${slug}</a></p>
                            </div>
                        `,
                    }).catch(() => {});
                } catch {}

                const resultPayload = {
                    company: {
                        id: company._id,
                        tenantId: company.tenantId,
                        name: company.name,
                        slug: company.slug,
                        domain: company.domain,
                        industry: company.industry,
                        size: company.size,
                        logoUrl: company.logoUrl || null,
                        status: company.status,
                        subscriptionId: company.subscriptionId || null,
                        createdAt: company.createdAt,
                    },
                    admin: {
                        id: admin._id,
                        name: admin.name,
                        email: admin.email,
                        role: 'COMPANY_ADMIN',
                        companyId: company._id,
                        tenantId: company.tenantId,
                    },
                    whiteLabel: {
                        enabled: whiteLabelSettings.enabled,
                        displayName: whiteLabelSettings.displayName,
                        logoUrl: whiteLabelSettings.logoUrl,
                        faviconUrl: whiteLabelSettings.faviconUrl,
                        appTitle: whiteLabelSettings.appTitle,
                        theme: whiteLabelSettings.theme,
                        loginPage: whiteLabelSettings.loginPage,
                        customDomain: whiteLabelSettings.customDomain,
                        domainVerificationStatus: whiteLabelSettings.domainVerificationStatus,
                    },
                };

                return resultPayload;
            } catch (error) {
                if (!transactionCommitted) {
                    await session.abortTransaction();
                }
                throw error;
            } finally {
                session.endSession();
            }
        })();

        companyCreationIdempotencyMap.set(normalizedKey, {
            inFlight: executionPromise,
            expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });

        try {
            const finalResult = await executionPromise;
            companyCreationIdempotencyMap.set(normalizedKey, {
                result: finalResult,
                expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
            });
            return finalResult;
        } catch (err) {
            companyCreationIdempotencyMap.delete(normalizedKey);
            throw err;
        }
    }

    /**
     * Fetch a single company by its ObjectId. Excludes DELETED companies.
     */
    static async findById(id: string) {
        return Company.findOne({ _id: id, status: { $ne: 'DELETED' } }).populate('adminId', 'name email status isActive');
    }

    /**
     * Fetch all companies. Excludes DELETED companies.
     */
    static async findAll() {
        return Company.find({ status: { $ne: 'DELETED' } }).sort({ createdAt: -1 }).populate('adminId', 'name email status isActive');
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
        if (data.logoUrl !== undefined) company.logoUrl = data.logoUrl ? data.logoUrl.trim() : undefined;

        await company.save();
        return company;
    }

    /**
     * Validates and uploads a company logo using the active storage configuration.
     */
    static async uploadLogo(file?: Express.Multer.File, companyId?: string): Promise<{ logoUrl: string; storageKey?: string }> {
        if (!file || !file.buffer) {
            const err: any = new Error('No image file provided for logo upload.');
            err.statusCode = 400;
            throw err;
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
            const err: any = new Error(`Unsupported image format .${ext}. Only PNG, JPEG, and WebP are allowed.`);
            err.statusCode = 400;
            throw err;
        }

        if (!ALLOWED_LOGO_MIME_TYPES.has(file.mimetype.toLowerCase())) {
            const err: any = new Error(`Unsupported MIME type ${file.mimetype}. Only PNG, JPEG, and WebP are allowed.`);
            err.statusCode = 400;
            throw err;
        }

        if (file.size > MAX_LOGO_SIZE_BYTES) {
            const currentMB = (file.size / (1024 * 1024)).toFixed(2);
            const err: any = new Error(`File size (${currentMB}MB) exceeds the maximum allowed logo size of 5MB.`);
            err.statusCode = 400;
            throw err;
        }

        const activeConfig = await StorageConfigurationService.getActiveConfiguration();
        const basePath = (activeConfig?.configuration?.basePath || 'worksphere').replace(/^\/+|\/+$/g, '');
        const targetFolder = 'logos';
        const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const companyFolder = companyId ? `companies/${companyId}` : 'platform';
        const storageKey = `${basePath}/${companyFolder}/${targetFolder}/${uniquePrefix}-${sanitizedOriginal}`;

        let logoUrl: string;

        if (activeConfig && activeConfig.enabled) {
            try {
                const provider = StorageProviderFactory.createProvider(
                    activeConfig.provider,
                    activeConfig.configuration
                );
                const uploadResult = await provider.uploadFile(file.buffer, storageKey, file.mimetype);
                logoUrl = uploadResult.storageUrl;
            } catch (storageErr: any) {
                console.error('[CompanyService] Storage provider upload failed:', storageErr);
                const pullZone = activeConfig.configuration?.pullZoneUrl?.replace(/\/+$/, '') || 'https://storage.worksphere.io';
                logoUrl = `${pullZone}/${storageKey}`;
            }
        } else {
            // Development / test fallback when cloud storage is unconfigured
            const pullZone = activeConfig?.configuration?.pullZoneUrl?.replace(/\/+$/, '') || 'https://storage.worksphere.io';
            logoUrl = `${pullZone}/${storageKey}`;
        }

        // Ensure logoUrl is a valid HTTPS delivery URL if it's from Cloudinary
        if (logoUrl && logoUrl.startsWith('cloudinary://')) {
            logoUrl = CloudinaryStorageProvider.toHttpsDeliveryUrl(logoUrl, activeConfig?.configuration?.cloudName);
        }

        // If an existing company ID was provided, automatically persist the new logo URL
        if (companyId) {
            const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
            if (company) {
                company.logoUrl = logoUrl;
                await company.save();
            }
        }

        return { logoUrl, storageKey };
    }

    /**
     * Removes the company logo.
     */
    static async deleteLogo(companyId: string) {
        const company = await Company.findOne({ _id: companyId, status: { $ne: 'DELETED' } });
        if (!company) {
            throw new Error('Company not found');
        }
        company.logoUrl = undefined;
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

        // Suspend Company Admin user(s)
        if (company.adminId) {
            await User.updateOne(
                { _id: company.adminId as any },
                {
                    $set: {
                        status: 'SUSPENDED',
                        isActive: false,
                        accountStatus: 'SUSPENDED',
                    }
                }
            );
        }

        const adminRole = await Role.findOne({ name: 'COMPANY_ADMIN' });
        if (adminRole) {
            await User.updateMany(
                { companyId: company._id, role: adminRole._id },
                {
                    $set: {
                        status: 'SUSPENDED',
                        isActive: false,
                        accountStatus: 'SUSPENDED',
                    }
                }
            );
        }

        // Revoke all sessions for all users in this company
        const companyUsers = await User.find({ companyId: company._id }).select('_id');
        for (const u of companyUsers) {
            await SessionService.revokeAllUserSessions(String(u._id)).catch(() => {});
            try {
                const redis = getRedisClient();
                if (redis) {
                    await redis.del(`session:${u._id}`, `user:${u._id}`).catch(() => {});
                }
            } catch {}
        }

        // Disconnect all sockets for company
        try {
            const io = getSocketServer();
            if (io) {
                io.in(`company:${companyId}`).disconnectSockets(true);
            }
        } catch {}

        await AuditLogService.log({
            action: AuditAction.COMPANY_SUSPENDED,
            actorId: actorUserId,
            companyId: companyId,
            companyName: company.name,
            success: true,
            description: `Company "${company.name}" suspended. Reason: ${reason ?? 'None'}`,
            metadata: { reason },
        });

        // ── SuperAdmin Notifications ───────────────────────────────────────────
        SuperAdminNotificationService.dispatch({
            type: 'COMPANY_SUSPENDED',
            companyId: String(company._id),
            actorId: actorUserId,
            eventId: `comp_susp_${company._id}_${Date.now()}`,
            metadata: {
                companyName: company.name,
                reason: reason ?? 'Administrative suspension',
                suspendedAt: company.suspendedAt?.toISOString(),
            },
        }).catch(() => {});

        if (company.adminId) {
            SuperAdminNotificationService.dispatch({
                type: 'COMPANY_ADMIN_DEACTIVATED',
                companyId: String(company._id),
                actorId: actorUserId,
                eventId: `comp_adm_deact_${company.adminId}_${Date.now()}`,
                metadata: {
                    companyName: company.name,
                    reason: reason ?? 'Company suspended',
                },
            }).catch(() => {});
        }

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

        // Restore Company Admin backend account status and login access
        if (company.adminId) {
            await User.updateOne(
                { _id: company.adminId as any },
                {
                    $set: {
                        status: 'ACTIVE',
                        isActive: true,
                        isDeleted: false,
                        accountStatus: 'ACTIVE',
                        deletedAt: null,
                        deletedBy: null,
                        deletionReason: null,
                        restoredAt: new Date(),
                        restoredBy: actorUserId as any,
                    }
                }
            );
        }

        const adminRole = await Role.findOne({ name: 'COMPANY_ADMIN' });
        if (adminRole) {
            await User.updateMany(
                { companyId: company._id, role: adminRole._id, status: { $in: ['SUSPENDED', 'DEACTIVATED'] } },
                {
                    $set: {
                        status: 'ACTIVE',
                        isActive: true,
                        isDeleted: false,
                        accountStatus: 'ACTIVE',
                        deletedAt: null,
                        deletedBy: null,
                        deletionReason: null,
                        restoredAt: new Date(),
                        restoredBy: actorUserId as any,
                    }
                }
            );
        }

        await AuditLogService.log({
            action: AuditAction.COMPANY_ACTIVATED,
            actorId: actorUserId,
            companyId: companyId,
            companyName: company.name,
            success: true,
            description: `Company "${company.name}" re-activated and admin login restored`,
        });

        // ── SuperAdmin Notification ────────────────────────────────────────────
        SuperAdminNotificationService.dispatch({
            type: 'COMPANY_ACTIVATED',
            companyId: String(company._id),
            actorId: actorUserId,
            eventId: `comp_act_${company._id}_${Date.now()}`,
            metadata: {
                companyName: company.name,
                activatedAt: company.activatedAt?.toISOString(),
            },
        }).catch(() => {});

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

        // ── SuperAdmin Notification ────────────────────────────────────────────
        SuperAdminNotificationService.dispatch({
            type: 'COMPANY_DELETED',
            companyId: String(company._id),
            actorId: actorUserId,
            eventId: `comp_del_${company._id}_${Date.now()}`,
            metadata: {
                companyName: company.name,
                deletedAt: company.deletedAt?.toISOString(),
            },
        }).catch(() => {});

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
