import { Types } from 'mongoose';
import { Project } from '../modules/companyadmin/projects/project.model';
import { Task } from '../modules/tasks/task.model';
import { CompanyMember } from '../modules/companyadmin/invitations/company-member.model';
import { Invitation } from '../modules/companyadmin/invitations/invitation.model';
import { User } from '../modules/users/user.model';
import { FileModel } from '../modules/files/file.model';
import { QuotaReservation, QuotaResourceType } from '../modules/super-admin/entitlements/quota-reservation.model';
import { EntitlementService } from './entitlement.service';
import { AppError } from '../utils/AppError';
import { Company } from '../modules/super-admin/companies/company.model';

export { QuotaResourceType } from '../modules/super-admin/entitlements/quota-reservation.model';

export interface QuotaContext {
    projectId?: string;
    userId?: string;
}

export interface QuotaCheckResult {
    allowed: boolean;
    limit: number;
    currentUsage: number;
    remaining: number;
    isUnlimited: boolean;
    unit: string;
    resource: QuotaResourceType;
    upgradeGuidance: string;
    reason?: 'PLAN_LIMIT_REACHED' | 'PLAN_UPGRADE_REQUIRED';
    bytes?: {
        limitBytes: number;
        currentBytes: number;
        remainingBytes: number;
    };
}

export interface QuotaReservationHandle {
    reservationId: string | null;
    resource: QuotaResourceType;
    amount: number;
    commit: () => Promise<void>;
    release: () => Promise<void>;
}

export interface CompanyQuotaSummary {
    companyId: string;
    companyName: string;
    planName: string;
    resources: Record<QuotaResourceType, {
        limit: number | string;
        currentUsage: number;
        remaining: number | string;
        unit: string;
        isUnlimited: boolean;
        isOverLimit: boolean;
    }>;
}

export interface ReconciliationReport {
    timestamp: Date;
    dryRun: boolean;
    totalCompaniesEvaluated: number;
    staleReservationsCleaned: number;
    summaries: CompanyQuotaSummary[];
}

export class SubscriptionQuotaService {

    // ─── Resource → Feature Catalog Key Mapping ───────────────────────────────

    public static mapResourceToFeatureKey(resource: QuotaResourceType): string {
        switch (resource) {
            case 'projects':
                return 'PROJECTS';
            case 'tasks':
                return 'TASKS';
            case 'users':
                return 'USERS';
            case 'storage':
                return 'STORAGE';
            default:
                return String(resource).toUpperCase();
        }
    }

    private static getResourceDisplayName(resource: QuotaResourceType): string {
        switch (resource) {
            case 'projects':
                return 'projects';
            case 'tasks':
                return 'tasks';
            case 'users':
                return 'users';
            case 'storage':
                return 'storage';
            default:
                return resource;
        }
    }

    // ─── Ground Truth Live Usage Calculators ─────────────────────────────────

    /**
     * Counts active projects for a company.
     * Archived projects count toward the quota as per product policy (they do not release capacity).
     * Soft-deleted projects (deletedAt != null) are excluded and do not count.
     */
    static async getActiveProjectsCount(companyId: string): Promise<number> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return 0;
        return Project.countDocuments({
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        });
    }

    /**
     * Counts active tasks for a company or project.
     * Soft-deleted/archived tasks (isArchived: true) are excluded.
     * If unit is PER_PROJECT and a projectId is provided, counts tasks within that project.
     * Otherwise, counts all active tasks in the company.
     */
    static async getActiveTasksCount(
        companyId: string,
        context?: QuotaContext,
        unit?: string
    ): Promise<number> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return 0;

        const isPerProject = unit === 'PER_PROJECT' || (context?.projectId && Types.ObjectId.isValid(context.projectId));

        if (isPerProject && context?.projectId && Types.ObjectId.isValid(context.projectId)) {
            return Task.countDocuments({
                companyId: new Types.ObjectId(companyId),
                projectId: new Types.ObjectId(context.projectId),
                isArchived: false,
            });
        }

        return Task.countDocuments({
            companyId: new Types.ObjectId(companyId),
            isArchived: false,
        });
    }

    /**
     * Counts active seats for a company.
     * Formula:
     *   Distinct active User IDs across CompanyMember ({ status: 'ACTIVE' }) and User ({ companyId, status: 'ACTIVE' })
     *   + Active pending invitations ({ status: 'PENDING', expiresAt > now })
     * Inactive/suspended members do not consume seats.
     * Pending invitations reserve seats so unaccepted invites cannot bypass plan limits.
     */
    static async getActiveUsersCount(companyId: string): Promise<number> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return 0;
        const compObjId = new Types.ObjectId(companyId);

        // 1. Collect all active member user IDs
        const activeMembers = await CompanyMember.find({
            companyId: compObjId,
            status: 'ACTIVE',
        }).select('userId').lean();
        const activeUserIds = new Set<string>(activeMembers.map((m) => String(m.userId)));

        // 2. Collect any active company users (e.g. company admin) not in CompanyMember
        const activeUsers = await User.find({
            companyId: compObjId,
            status: 'ACTIVE',
        }).select('_id').lean();
        for (const u of activeUsers) {
            activeUserIds.add(String(u._id));
        }

        // 3. Count active pending invitations that reserve seats
        const pendingInvitesCount = await Invitation.countDocuments({
            companyId: compObjId,
            status: 'PENDING',
            expiresAt: { $gt: new Date() },
        });

        return activeUserIds.size + pendingInvitesCount;
    }

    /**
     * Calculates the total bytes consumed by a company from non-deleted files.
     * Soft-deleted files (deletedAt != null) release capacity immediately.
     */
    static async getStorageUsageBytes(companyId: string): Promise<number> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return 0;

        const agg = await FileModel.aggregate([
            {
                $match: {
                    companyId: new Types.ObjectId(companyId),
                    deletedAt: null,
                },
            },
            {
                $group: {
                    _id: null,
                    totalBytes: { $sum: '$size' },
                },
            },
        ]);

        return agg.length > 0 && agg[0].totalBytes ? agg[0].totalBytes : 0;
    }

    /**
     * Retrieves the sum of in-flight pending reservations for this company, resource, and context.
     */
    private static async getPendingReservedAmount(
        companyId: string,
        resource: QuotaResourceType,
        context?: QuotaContext
    ): Promise<number> {
        if (!companyId || !Types.ObjectId.isValid(companyId)) return 0;

        const match: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            resource,
            status: 'PENDING',
            expiresAt: { $gt: new Date() },
        };

        if (resource === 'tasks' && context?.projectId) {
            match.contextId = String(context.projectId);
        }

        const agg = await QuotaReservation.aggregate([
            { $match: match },
            { $group: { _id: null, totalReserved: { $sum: '$amount' } } },
        ]);

        return agg.length > 0 && agg[0].totalReserved ? agg[0].totalReserved : 0;
    }

    // ─── Quota Evaluation ─────────────────────────────────────────────────────

    /**
     * Evaluates resource quota for a company.
     * Respects UNLIMITED, LIMITED, and DISABLED plan configurations.
     * Fails closed: unconfigured, missing, or negative numeric limits deny creation.
     */
    static async checkQuota(
        companyId: string,
        resource: QuotaResourceType,
        requestedAmount = 1,
        context?: QuotaContext
    ): Promise<QuotaCheckResult> {
        const featureKey = this.mapResourceToFeatureKey(resource);
        const entitlement = await EntitlementService.getEntitlementDetails(companyId, featureKey);

        const upgradeGuidance = `Please upgrade your subscription plan to add more ${this.getResourceDisplayName(resource)}.`;

        // 1. Subscription Inactive or Non-Existent
        if (!entitlement.hasActiveSubscription) {
            return {
                allowed: false,
                limit: 0,
                currentUsage: 0,
                remaining: 0,
                isUnlimited: false,
                unit: entitlement.unit || 'COUNT',
                resource,
                upgradeGuidance: 'Your subscription is inactive or expired. Please activate your subscription.',
                reason: 'PLAN_UPGRADE_REQUIRED',
            };
        }

        // 2. Feature Disabled / Not in Plan
        if (!entitlement.enabled) {
            return {
                allowed: false,
                limit: 0,
                currentUsage: 0,
                remaining: 0,
                isUnlimited: false,
                unit: entitlement.unit || 'COUNT',
                resource,
                upgradeGuidance: `Feature '${featureKey}' is not included in your current subscription plan.`,
                reason: 'PLAN_UPGRADE_REQUIRED',
            };
        }

        // 3. Explicitly UNLIMITED Feature
        if (entitlement.limitType === 'UNLIMITED') {
            let liveUsage = 0;
            if (resource === 'projects') liveUsage = await this.getActiveProjectsCount(companyId);
            else if (resource === 'tasks') liveUsage = await this.getActiveTasksCount(companyId, context, entitlement.unit);
            else if (resource === 'users') liveUsage = await this.getActiveUsersCount(companyId);
            else if (resource === 'storage') liveUsage = await this.getStorageUsageBytes(companyId);

            return {
                allowed: true,
                limit: -1,
                currentUsage: liveUsage,
                remaining: -1,
                isUnlimited: true,
                unit: entitlement.unit || 'COUNT',
                resource,
                upgradeGuidance: '',
            };
        }

        // 4. Fail-Closed: Missing or Invalid Numeric Limit
        if (
            entitlement.limitType !== 'LIMITED' ||
            entitlement.value === null ||
            entitlement.value === undefined ||
            typeof entitlement.value !== 'number' ||
            isNaN(entitlement.value) ||
            entitlement.value < 0
        ) {
            return {
                allowed: false,
                limit: 0,
                currentUsage: 0,
                remaining: 0,
                isUnlimited: false,
                unit: entitlement.unit || 'COUNT',
                resource,
                upgradeGuidance: 'This resource limit is unconfigured or invalid on your plan. Please contact your plan administrator.',
                reason: 'PLAN_LIMIT_REACHED',
            };
        }

        const configuredLimit = entitlement.value;
        const unit = entitlement.unit || (resource === 'storage' ? 'GB' : 'COUNT');

        // ── STORAGE ACCOUNTING (Byte-Level Precision) ──
        if (resource === 'storage') {
            const ONE_GB = 1024 * 1024 * 1024;
            const ONE_MB = 1024 * 1024;

            let multiplier = ONE_GB;
            if (unit.toUpperCase() === 'MB') multiplier = ONE_MB;
            else if (unit.toUpperCase() === 'BYTES' || unit.toUpperCase() === 'B') multiplier = 1;

            const limitBytes = configuredLimit * multiplier;
            const liveBytes = await this.getStorageUsageBytes(companyId);
            const reservedBytes = await this.getPendingReservedAmount(companyId, 'storage');
            const effectiveBytes = liveBytes + reservedBytes;

            const requestedBytes = requestedAmount; // requestedAmount is file.size in bytes
            const allowed = effectiveBytes + requestedBytes <= limitBytes;
            const remainingBytes = Math.max(0, limitBytes - effectiveBytes);

            const limitFormatted = configuredLimit;
            const currentUsageFormatted = Number((effectiveBytes / multiplier).toFixed(2));
            const remainingFormatted = Number((remainingBytes / multiplier).toFixed(2));

            return {
                allowed,
                limit: limitFormatted,
                currentUsage: currentUsageFormatted,
                remaining: remainingFormatted,
                isUnlimited: false,
                unit,
                resource,
                upgradeGuidance,
                reason: allowed ? undefined : 'PLAN_LIMIT_REACHED',
                bytes: {
                    limitBytes,
                    currentBytes: effectiveBytes,
                    remainingBytes,
                },
            };
        }

        // ── COUNT-BASED RESOURCES (Projects, Tasks, Users) ──
        let liveUsage = 0;
        if (resource === 'projects') {
            liveUsage = await this.getActiveProjectsCount(companyId);
        } else if (resource === 'tasks') {
            liveUsage = await this.getActiveTasksCount(companyId, context, unit);
        } else if (resource === 'users') {
            liveUsage = await this.getActiveUsersCount(companyId);
        }

        const reservedAmount = await this.getPendingReservedAmount(companyId, resource, context);
        const effectiveUsage = liveUsage + reservedAmount;
        const allowed = effectiveUsage + requestedAmount <= configuredLimit;
        const remaining = Math.max(0, configuredLimit - effectiveUsage);

        return {
            allowed,
            limit: configuredLimit,
            currentUsage: effectiveUsage,
            remaining,
            isUnlimited: false,
            unit,
            resource,
            upgradeGuidance,
            reason: allowed ? undefined : 'PLAN_LIMIT_REACHED',
        };
    }

    /**
     * Authoritatively asserts quota availability.
     * Throws HTTP 403 AppError with structured metadata if quota is exhausted or feature is excluded.
     */
    static async assertQuota(
        companyId: string,
        resource: QuotaResourceType,
        requestedAmount = 1,
        context?: QuotaContext
    ): Promise<QuotaCheckResult> {
        const check = await this.checkQuota(companyId, resource, requestedAmount, context);

        if (!check.allowed) {
            const resourceDisplayName = this.getResourceDisplayName(resource);
            const featureKey = this.mapResourceToFeatureKey(resource);

            if (check.reason === 'PLAN_UPGRADE_REQUIRED') {
                const message = `${resourceDisplayName.charAt(0).toUpperCase() + resourceDisplayName.slice(1)} is not included in your subscription plan. Please upgrade your subscription.`;
                throw new AppError(message, 403, {
                    code: 'PLAN_UPGRADE_REQUIRED',
                    featureKey,
                    resource,
                });
            }

            // PLAN_LIMIT_REACHED
            let unitSuffix = resourceDisplayName;
            if (check.unit === 'PER_PROJECT' && resource === 'tasks') {
                unitSuffix = 'tasks per project';
            } else if (check.resource === 'storage') {
                unitSuffix = `${check.unit} storage`;
            }

            const message = `Your plan allows up to ${check.limit} ${unitSuffix}. Your company currently has ${check.currentUsage} ${unitSuffix}.`;

            throw new AppError(message, 403, {
                code: 'PLAN_LIMIT_REACHED',
                resource,
                limit: check.limit,
                currentUsage: check.currentUsage,
                remaining: check.remaining,
                unit: check.unit,
                upgradeGuidance: check.upgradeGuidance,
            });
        }

        return check;
    }

    /**
     * Atomically asserts quota and places a temporary reservation to prevent race conditions.
     * Must be committed upon successful resource creation or released on error.
     */
    static async reserveQuota(
        companyId: string,
        resource: QuotaResourceType,
        requestedAmount = 1,
        context?: QuotaContext
    ): Promise<QuotaReservationHandle> {
        // 1. Initial check (verifies subscription active, feature enabled, valid limit)
        const check = await this.assertQuota(companyId, resource, requestedAmount, context);

        // If unlimited, no physical reservation needed
        if (check.isUnlimited) {
            return {
                reservationId: null,
                resource,
                amount: requestedAmount,
                commit: async () => {},
                release: async () => {},
            };
        }

        // 2. Pre-create pending reservation record atomically
        const reservation = await QuotaReservation.create({
            companyId: new Types.ObjectId(companyId),
            resource,
            contextId: context?.projectId ? String(context.projectId) : null,
            amount: requestedAmount,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 30 * 1000), // 30-second TTL
        });

        // 3. Concurrency check: sum all pending reservations created up to and including this one
        const match: Record<string, any> = {
            companyId: new Types.ObjectId(companyId),
            resource,
            status: 'PENDING',
            expiresAt: { $gt: new Date() },
            _id: { $lte: reservation._id },
        };
        if (resource === 'tasks' && context?.projectId) {
            match.contextId = String(context.projectId);
        }

        const priorAgg = await QuotaReservation.aggregate([
            { $match: match },
            { $group: { _id: null, totalReserved: { $sum: '$amount' } } },
        ]);
        const priorAndSelfReserved = priorAgg.length > 0 && priorAgg[0].totalReserved ? priorAgg[0].totalReserved : requestedAmount;

        // 4. Verify that live usage + prior & self reservations does not exceed limit
        if (resource === 'storage') {
            const ONE_GB = 1024 * 1024 * 1024;
            const ONE_MB = 1024 * 1024;
            let multiplier = ONE_GB;
            if (check.unit?.toUpperCase() === 'MB') multiplier = ONE_MB;
            else if (check.unit?.toUpperCase() === 'BYTES' || check.unit?.toUpperCase() === 'B') multiplier = 1;

            const liveBytes = await this.getStorageUsageBytes(companyId);
            const totalEffectiveBytes = liveBytes + priorAndSelfReserved;
            const limitBytes = check.limit * multiplier;

            if (totalEffectiveBytes > limitBytes) {
                await QuotaReservation.deleteOne({ _id: reservation._id }).catch(() => {});
                throw new AppError(
                    `Your plan allows up to ${check.limit} ${check.unit} storage. Your company currently has ${Number((totalEffectiveBytes / multiplier).toFixed(2))} ${check.unit} storage.`,
                    403,
                    {
                        code: 'PLAN_LIMIT_REACHED',
                        resource,
                        limit: check.limit,
                        currentUsage: Number((totalEffectiveBytes / multiplier).toFixed(2)),
                        remaining: 0,
                        unit: check.unit,
                        upgradeGuidance: check.upgradeGuidance,
                    }
                );
            }
        } else {
            let liveUsage = 0;
            if (resource === 'projects') liveUsage = await this.getActiveProjectsCount(companyId);
            else if (resource === 'tasks') liveUsage = await this.getActiveTasksCount(companyId, context, check.unit);
            else if (resource === 'users') liveUsage = await this.getActiveUsersCount(companyId);

            const totalEffective = liveUsage + priorAndSelfReserved;
            if (totalEffective > check.limit) {
                await QuotaReservation.deleteOne({ _id: reservation._id }).catch(() => {});
                let unitSuffix = this.getResourceDisplayName(resource);
                if (check.unit === 'PER_PROJECT' && resource === 'tasks') unitSuffix = 'tasks per project';

                throw new AppError(
                    `Your plan allows up to ${check.limit} ${unitSuffix}. Your company currently has ${totalEffective} ${unitSuffix}.`,
                    403,
                    {
                        code: 'PLAN_LIMIT_REACHED',
                        resource,
                        limit: check.limit,
                        currentUsage: totalEffective,
                        remaining: 0,
                        unit: check.unit,
                        upgradeGuidance: check.upgradeGuidance,
                    }
                );
            }
        }

        const reservationId = String(reservation._id);

        return {
            reservationId,
            resource,
            amount: requestedAmount,
            commit: async () => {
                await QuotaReservation.deleteOne({ _id: reservation._id }).catch(() => {});
            },
            release: async () => {
                await QuotaReservation.deleteOne({ _id: reservation._id }).catch(() => {});
            },
        };
    }

    // ─── Reconciliation & Diagnostic Tools ────────────────────────────────────

    /**
     * Cleans up any expired or stale reservations.
     */
    static async cleanupStaleReservations(): Promise<number> {
        const result = await QuotaReservation.deleteMany({
            $or: [
                { expiresAt: { $lte: new Date() } },
                { status: { $in: ['COMMITTED', 'RELEASED'] } },
            ],
        });
        return result.deletedCount || 0;
    }

    /**
     * Generates a dry-run or active reconciliation report across all companies or a single company.
     * Reports live persisted usage, configured limits, remaining capacity, and over-limit status.
     */
    static async reconcileCompanyQuotas(
        companyId?: string,
        dryRun = true
    ): Promise<ReconciliationReport> {
        const cleanedReservationsCount = dryRun ? 0 : await this.cleanupStaleReservations();

        const query: Record<string, any> = { isActive: true, status: 'ACTIVE' };
        if (companyId && Types.ObjectId.isValid(companyId)) {
            query._id = new Types.ObjectId(companyId);
        }

        const companies = await Company.find(query).lean();
        const summaries: CompanyQuotaSummary[] = [];

        const resources: QuotaResourceType[] = ['projects', 'tasks', 'users', 'storage'];

        for (const company of companies) {
            const cId = String(company._id);
            const effective = await EntitlementService.getEffectiveEntitlements(cId);

            const resourceReports: any = {};

            for (const r of resources) {
                const check = await this.checkQuota(cId, r, 0);
                const isOverLimit = !check.isUnlimited && check.currentUsage > check.limit;

                resourceReports[r] = {
                    limit: check.isUnlimited ? 'UNLIMITED' : check.limit,
                    currentUsage: check.currentUsage,
                    remaining: check.isUnlimited ? 'UNLIMITED' : check.remaining,
                    unit: check.unit,
                    isUnlimited: check.isUnlimited,
                    isOverLimit,
                };
            }

            summaries.push({
                companyId: cId,
                companyName: company.name,
                planName: effective.subscription?.planName || 'No Active Plan',
                resources: resourceReports,
            });
        }

        return {
            timestamp: new Date(),
            dryRun,
            totalCompaniesEvaluated: companies.length,
            staleReservationsCleaned: cleanedReservationsCount,
            summaries,
        };
    }
}

export default SubscriptionQuotaService;
