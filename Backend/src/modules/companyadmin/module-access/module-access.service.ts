import { Types } from 'mongoose';
import { CompanyModuleAccess } from './module-access.model';
import {
    ICompanyModuleAccessDocument,
    IModuleDefinition,
    ModuleKey,
    OverrideState,
    EffectiveEmployeeModuleAccess,
    MemberEffectiveModuleAccessResponse,
    UpdateGlobalModuleAccessDto,
    UpdateEmployeeOverrideDto,
    BulkUpdateEmployeeOverridesDto,
    SelectedMembersAccessResponse,
    AggregateModuleState,
    AggregateState,
    BulkUpdateResult,
} from './module-access.types';
import {
    SUPPORTED_MODULES,
    DEFAULT_GLOBAL_MODULE_SETTINGS,
    VALID_MODULE_KEYS,
    normalizeModuleKey,
} from './module-access.constants';
import { CompanyMember } from '../invitations/company-member.model';
import { User } from '../../users/user.model';
import { FeatureAccessService } from '../settings/feature-access.service';
import { EntitlementService } from '../../../services/entitlement.service';
import { FeatureRevocationService } from '../settings/feature-revocation.service';
import { AppError } from '../../../utils/AppError';
import { getRedisClient } from '../../../config/redis';
import { getSocketServer } from '../../../sockets/socket-server';

export interface GetEmployeesModuleAccessQuery {
    companyId: string;
    employeeIds?: string[];
    page?: number;
    limit?: number;
    search?: string;
    departmentId?: string;
    memberType?: string;
    overrideFilter?: 'ALL' | 'WITH_OVERRIDES' | 'INHERITING';
    moduleKeyFilter?: ModuleKey;
    moduleStatusFilter?: 'ENABLED' | 'DISABLED';
}

/**
 * Safely resolves an override state while preserving the distinction between
 * explicit false ('DISABLED'), explicit true ('ENABLED'), and unconfigured ('INHERIT').
 * Prevents falsy 'false || INHERIT' coercion bugs.
 */
export function resolveOverrideState(raw: any): OverrideState {
    if (raw === undefined || raw === null) return 'INHERIT';
    if (typeof raw === 'boolean') return raw ? 'ENABLED' : 'DISABLED';
    if (typeof raw === 'string') {
        const upper = raw.trim().toUpperCase();
        if (upper === 'ENABLED' || upper === 'TRUE' || upper === '1') return 'ENABLED';
        if (upper === 'DISABLED' || upper === 'FALSE' || upper === '0') return 'DISABLED';
        if (upper === 'INHERIT') return 'INHERIT';
    }
    return 'INHERIT';
}

export class ModuleAccessService {
    /**
     * Retrieve supported sidebar module catalog with metadata
     */
    static getModuleCatalog(): { modules: IModuleDefinition[]; totalModules: number; categories: string[] } {
        return {
            modules: SUPPORTED_MODULES,
            totalModules: SUPPORTED_MODULES.length,
            categories: Array.from(new Set(SUPPORTED_MODULES.map((m) => m.category))),
        };
    }

    /**
     * Invalidate cached module access and broadcast real-time sync events.
     * When userIds is provided, invalidates specific members.
     * When userIds is omitted or empty, performs company-wide invalidation (all members).
     */
    static async invalidateMemberAccessCache(companyId: string, userIds?: string[]): Promise<void> {
        try {
            const redis = getRedisClient();
            if (redis) {
                if (userIds && userIds.length > 0) {
                    const keys = [
                        `worksphere:cache:module_access:${companyId}:global`,
                        ...userIds.map((u) => `worksphere:cache:module_access:${companyId}:${u}`),
                    ];
                    await redis.del(...keys).catch(() => {});
                } else {
                    const pattern = `worksphere:cache:module_access:${companyId}:*`;
                    const keys = await redis.keys(pattern).catch(() => []);
                    if (keys.length > 0) {
                        await redis.del(...keys).catch(() => {});
                    }
                }
                await redis.publish(
                    'worksphere:module_access_updated',
                    JSON.stringify({
                        companyId,
                        userIds: userIds || [],
                        timestamp: Date.now(),
                    })
                ).catch(() => {});
            }
        } catch {
            // Redis error fallback
        }

        try {
            const io = getSocketServer();
            if (io) {
                if (userIds && userIds.length > 0) {
                    userIds.forEach((uId) => {
                        io.to(`user:${uId}`).emit('member:module_access_updated', {
                            companyId,
                            userId: uId,
                            timestamp: Date.now(),
                        });
                    });
                }
                io.to(`company:${companyId}`).emit('company:module_access_updated', {
                    companyId,
                    affectedUserIds: userIds || [],
                    timestamp: Date.now(),
                });
            }
        } catch {
            // Socket error fallback
        }
    }
    /**
     * Get or initialize the company module access record
     */
    static async getOrCreateCompanyModuleAccess(
        companyId: string | Types.ObjectId
    ): Promise<ICompanyModuleAccessDocument> {
        const cId = new Types.ObjectId(companyId);
        let record = await CompanyModuleAccess.findOne({ companyId: cId });

        if (!record) {
            record = await CompanyModuleAccess.create({
                companyId: cId,
                globalSettings: { ...DEFAULT_GLOBAL_MODULE_SETTINGS },
                employeeOverrides: [],
                auditHistory: [],
                schemaVersion: 1,
            });
        } else if (!record.auditHistory) {
            record.auditHistory = [];
        }

        return record;
    }

    /**
     * Retrieve global module settings along with module availability & affected statistics
     */
    static async getGlobalModuleAccess(companyId: string) {
        const record = await this.getOrCreateCompanyModuleAccess(companyId);
        const companyFeatures = await FeatureAccessService.getCompanyFeatureFlags(companyId);

        // Fetch total active members
        const totalEmployees = await CompanyMember.countDocuments({
            companyId: new Types.ObjectId(companyId),
            status: 'ACTIVE',
        });

        const modulesWithStats = await Promise.all(
            SUPPORTED_MODULES.map(async (mod) => {
                const isGloballyEnabled = record.globalSettings[mod.key] ?? true;
                let isPermittedByPlan = true;
                let isPermittedByCompany = true;

                if (mod.featureFlag) {
                    isPermittedByCompany = companyFeatures[mod.featureFlag] ?? true;
                }

                if (mod.entitlement) {
                    try {
                        const entDetails = await EntitlementService.getEntitlementDetails(
                            companyId,
                            mod.entitlement
                        );
                        if (entDetails && !entDetails.enabled) {
                            isPermittedByPlan = false;
                        }
                    } catch {
                        isPermittedByPlan = false;
                    }
                }

                // Count custom overrides for this module
                let enabledOverrideCount = 0;
                let disabledOverrideCount = 0;

                record.employeeOverrides.forEach((emp) => {
                    const overridesMap = emp.overrides as any;
                    const state = overridesMap instanceof Map
                        ? overridesMap.get(mod.key)
                        : overridesMap?.[mod.key];

                    if (state === 'ENABLED') enabledOverrideCount++;
                    if (state === 'DISABLED') disabledOverrideCount++;
                });

                // Effective status for standard inheriting employee
                const effectiveForInheriting =
                    isPermittedByPlan && isPermittedByCompany && isGloballyEnabled;

                return {
                    ...mod,
                    isGloballyEnabled,
                    isPermittedByPlan,
                    isPermittedByCompany,
                    effectiveForInheriting,
                    stats: {
                        totalEmployees,
                        enabledOverrides: enabledOverrideCount,
                        disabledOverrides: disabledOverrideCount,
                        inheritingCount:
                            totalEmployees - (enabledOverrideCount + disabledOverrideCount),
                    },
                };
            })
        );

        return {
            companyId,
            globalSettings: record.globalSettings,
            modules: modulesWithStats,
            summary: {
                totalEmployees,
                totalModules: SUPPORTED_MODULES.length,
                totalCustomOverrides: record.employeeOverrides.length,
            },
        };
    }

    /**
     * Update global module visibility toggles
     */
    static async updateGlobalModuleAccess(
        companyId: string,
        dto: UpdateGlobalModuleAccessDto,
        updatedBy?: string
    ) {
        const record = await this.getOrCreateCompanyModuleAccess(companyId);
        const changedKeys: ModuleKey[] = [];

        for (const [key, enabled] of Object.entries(dto.modules)) {
            const mKey = key as ModuleKey;
            if (VALID_MODULE_KEYS.includes(mKey) && typeof enabled === 'boolean') {
                if (record.globalSettings[mKey] !== enabled) {
                    record.globalSettings[mKey] = enabled;
                    changedKeys.push(mKey);
                }
            }
        }

        if (changedKeys.length > 0) {
            record.markModified('globalSettings');
            record.updatedBy = updatedBy ? new Types.ObjectId(updatedBy) : null;
            record.auditHistory.push({
                actorId: updatedBy ? new Types.ObjectId(updatedBy) : new Types.ObjectId(),
                action: 'GLOBAL_UPDATE',
                affectedModuleKeys: changedKeys,
                details: `Updated global visibility for ${changedKeys.join(', ')}`,
                timestamp: new Date(),
            });

            await record.save();

            // Invalidate member access caches and notify all members of updated company defaults
            await this.invalidateMemberAccessCache(companyId);

            // If chat was disabled globally, invoke feature revocation
            if (changedKeys.includes('chat') && record.globalSettings.chat === false) {
                try {
                    await FeatureRevocationService.revokeCompanyFeatures(companyId, ['enableChat']);
                } catch {
                    // Feature revocation fallback
                }
            }
        }

        return this.getGlobalModuleAccess(companyId);
    }

    /**
     * Get paginated employees with their effective access and override details
     */
    static async getEmployeesModuleAccess(query: GetEmployeesModuleAccessQuery) {
        const {
            companyId,
            page = 1,
            limit = 20,
            search,
            memberType = 'EMPLOYEE',
            overrideFilter = 'ALL',
            moduleKeyFilter,
            moduleStatusFilter,
        } = query;

        const skip = (page - 1) * limit;
        const cObjectId = new Types.ObjectId(companyId);

        // Fetch company module access and company feature flags
        const moduleAccessDoc = await this.getOrCreateCompanyModuleAccess(companyId);
        const companyFeatures = await FeatureAccessService.getCompanyFeatureFlags(companyId);

        // Precompute plan entitlements
        const planEntitlements: Record<string, boolean> = {};
        for (const mod of SUPPORTED_MODULES) {
            if (mod.entitlement) {
                try {
                    const entDetails = await EntitlementService.getEntitlementDetails(
                        companyId,
                        mod.entitlement
                    );
                    planEntitlements[mod.key] = entDetails ? entDetails.enabled : false;
                } catch {
                    planEntitlements[mod.key] = false;
                }
            } else {
                planEntitlements[mod.key] = true;
            }
        }

        // Build match filter for CompanyMember
        const memberMatch: any = {
            companyId: cObjectId,
            status: 'ACTIVE',
        };

        if (query.employeeIds && query.employeeIds.length > 0) {
            const rawObjIds = query.employeeIds.map((id) => new Types.ObjectId(id));
            memberMatch.$or = [{ userId: { $in: rawObjIds } }, { _id: { $in: rawObjIds } }];
        }

        if (memberType && memberType !== 'ALL') {
            memberMatch.memberType = memberType;
        }

        const aggregationPipeline: any[] = [
            { $match: memberMatch },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: '$user' },
            {
                $lookup: {
                    from: 'designations',
                    localField: 'designationId',
                    foreignField: '_id',
                    as: 'designation',
                },
            },
            { $unwind: { path: '$designation', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'companyroles',
                    localField: 'roleId',
                    foreignField: '_id',
                    as: 'role',
                },
            },
            { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
        ];

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            aggregationPipeline.push({
                $match: {
                    $or: [
                        { 'user.name': searchRegex },
                        { 'user.email': searchRegex },
                        { 'designation.name': searchRegex },
                    ],
                },
            });
        }

        // Execute count pipeline
        const countResult = await CompanyMember.aggregate([
            ...aggregationPipeline,
            { $count: 'total' },
        ]);
        const total = countResult[0]?.total || 0;

        // Sorting and pagination
        aggregationPipeline.push(
            { $sort: { 'user.name': 1 } },
            { $skip: skip },
            { $limit: limit }
        );

        const memberRecords = await CompanyMember.aggregate(aggregationPipeline);

        // Build employee results with resolved effective module access
        const employees: EffectiveEmployeeModuleAccess[] = memberRecords.map((m) => {
            const userIdStr = String(m.user._id);

            // Find overrides for this employee
            const empOverrideDoc = moduleAccessDoc.employeeOverrides.find(
                (o) => String(o.employeeId) === userIdStr
            );

            const rawOverrides: Record<string, OverrideState> = {};
            if (empOverrideDoc) {
                const map = empOverrideDoc.overrides as any;
                if (map instanceof Map) {
                    map.forEach((val, k) => {
                        rawOverrides[k] = val as OverrideState;
                    });
                } else if (typeof map === 'object' && map) {
                    Object.assign(rawOverrides, map);
                }
            }

            const overrides: Record<ModuleKey, OverrideState> = {} as any;
            const effectiveAccess: Record<ModuleKey, boolean> = {} as any;
            const featureRestrictions: any = {};
            let customOverrideCount = 0;

            SUPPORTED_MODULES.forEach((mod) => {
                const overrideState = resolveOverrideState(rawOverrides[mod.key]);
                overrides[mod.key] = overrideState;
                if (overrideState !== 'INHERIT') customOverrideCount++;

                const isPlanPermitted = planEntitlements[mod.key] ?? true;
                const isCompanyPermitted = mod.featureFlag
                    ? (companyFeatures[mod.featureFlag] ?? true)
                    : true;
                const isGloballyEnabled = moduleAccessDoc.globalSettings[mod.key] ?? true;

                featureRestrictions[mod.key] = {
                    disabledByPlan: !isPlanPermitted,
                    disabledByCompany: !isCompanyPermitted,
                };

                // Precedence Rule Execution:
                // Effective access = (Plan Permitted && Company Permitted) && (Override State === ENABLED || (Override State === INHERIT && Global Enabled))
                if (!isPlanPermitted || !isCompanyPermitted) {
                    effectiveAccess[mod.key] = false;
                } else if (overrideState === 'DISABLED') {
                    effectiveAccess[mod.key] = false;
                } else if (overrideState === 'ENABLED') {
                    effectiveAccess[mod.key] = true;
                } else {
                    effectiveAccess[mod.key] = isGloballyEnabled;
                }
            });

            return {
                employeeId: userIdStr,
                employeeName: m.user.name,
                employeeEmail: m.user.email,
                avatar: m.user.avatar || null,
                memberType: m.memberType,
                designationName: m.designation?.name || 'Employee',
                roleName: m.role?.name || 'Member',
                overrideCount: customOverrideCount,
                overrides,
                effectiveAccess,
                globalSettings: moduleAccessDoc.globalSettings,
                featureRestrictions,
            };
        });

        // Filter by override state in-memory if requested
        let filteredEmployees = employees;
        if (overrideFilter === 'WITH_OVERRIDES') {
            filteredEmployees = filteredEmployees.filter((e) => e.overrideCount > 0);
        } else if (overrideFilter === 'INHERITING') {
            filteredEmployees = filteredEmployees.filter((e) => e.overrideCount === 0);
        }

        if (moduleKeyFilter && moduleStatusFilter) {
            const expectEnabled = moduleStatusFilter === 'ENABLED';
            filteredEmployees = filteredEmployees.filter(
                (e) => e.effectiveAccess[moduleKeyFilter] === expectEnabled
            );
        }

        return {
            employees: filteredEmployees,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }

    /**
     * Get single employee module access details
     */
    static async getSingleEmployeeModuleAccess(companyId: string, employeeId: string) {
        const empObjectId = new Types.ObjectId(employeeId);
        let member = await CompanyMember.findOne({
            companyId: new Types.ObjectId(companyId),
            userId: empObjectId,
        }).populate('userId roleId designationId');

        if (!member) {
            member = await CompanyMember.findOne({
                companyId: new Types.ObjectId(companyId),
                _id: empObjectId,
            }).populate('userId roleId designationId');
        }

        if (!member) {
            throw AppError.notFound('Employee does not belong to this company');
        }

        const user = member.userId as any;
        const canonicalUserId = String(user?._id || member.userId);
        const moduleAccessDoc = await this.getOrCreateCompanyModuleAccess(companyId);
        const companyFeatures = await FeatureAccessService.getCompanyFeatureFlags(companyId);

        const empOverrideDoc = moduleAccessDoc.employeeOverrides.find(
            (o) => String(o.employeeId) === canonicalUserId
        );

        const rawOverrides: Record<string, OverrideState> = {};
        if (empOverrideDoc) {
            const map = empOverrideDoc.overrides as any;
            if (map instanceof Map) {
                map.forEach((val, k) => {
                    rawOverrides[k] = val as OverrideState;
                });
            } else if (typeof map === 'object' && map) {
                Object.assign(rawOverrides, map);
            }
        }

        const overrides: Record<ModuleKey, OverrideState> = {} as any;
        const effectiveAccess: Record<ModuleKey, boolean> = {} as any;
        const featureRestrictions: any = {};
        let customOverrideCount = 0;

        for (const mod of SUPPORTED_MODULES) {
            const overrideState = resolveOverrideState(rawOverrides[mod.key]);
            overrides[mod.key] = overrideState;
            if (overrideState !== 'INHERIT') customOverrideCount++;

            let isPlanPermitted = true;
            if (mod.entitlement) {
                try {
                    const entDetails = await EntitlementService.getEntitlementDetails(
                        companyId,
                        mod.entitlement
                    );
                    if (entDetails && !entDetails.enabled) {
                        isPlanPermitted = false;
                    }
                } catch {
                    isPlanPermitted = false;
                }
            }

            const isCompanyPermitted = mod.featureFlag
                ? (companyFeatures[mod.featureFlag] ?? true)
                : true;
            const isGloballyEnabled = moduleAccessDoc.globalSettings[mod.key] ?? true;

            featureRestrictions[mod.key] = {
                disabledByPlan: !isPlanPermitted,
                disabledByCompany: !isCompanyPermitted,
            };

            if (!isPlanPermitted || !isCompanyPermitted) {
                effectiveAccess[mod.key] = false;
            } else if (overrideState === 'DISABLED') {
                effectiveAccess[mod.key] = false;
            } else if (overrideState === 'ENABLED') {
                effectiveAccess[mod.key] = true;
            } else {
                effectiveAccess[mod.key] = isGloballyEnabled;
            }
        }

        return {
            employeeId: canonicalUserId,
            memberId: String(member._id),
            employeeName: user?.name || 'Member',
            employeeEmail: user?.email || '',
            avatar: user?.avatar || null,
            memberType: member.memberType,
            designationName: (member.designationId as any)?.name || 'Employee',
            roleName: (member.roleId as any)?.name || 'Member',
            overrideCount: customOverrideCount,
            overrides,
            effectiveAccess,
            globalSettings: moduleAccessDoc.globalSettings,
            featureRestrictions,
            supportedModules: SUPPORTED_MODULES,
        };
    }

    /**
     * Retrieve access settings for multiple selected members with mixed-state analysis
     */
    static async getSelectedMembersModuleAccess(
        companyId: string,
        rawEmployeeIds: string[]
    ): Promise<SelectedMembersAccessResponse> {
        const cObjectId = new Types.ObjectId(companyId);
        const ids = Array.from(new Set(rawEmployeeIds.map((id) => String(id).trim())));

        if (ids.length === 0) {
            throw AppError.badRequest('At least one employee ID must be provided');
        }

        const idObjectIds = ids.map((id) => new Types.ObjectId(id));

        // 1. Verify tenant membership of ALL supplied IDs
        const memberDocs: any[] = [];
        const byUserId = await CompanyMember.find({
            companyId: cObjectId,
            userId: { $in: idObjectIds },
        }).populate('userId roleId designationId');

        if (Array.isArray(byUserId)) {
            memberDocs.push(...byUserId);
        }

        const matchedIds = new Set<string>();
        memberDocs.forEach((m) => {
            matchedIds.add(String(m._id));
            const u = (m.userId as any)?._id || m.userId;
            matchedIds.add(String(u));
        });

        const remainingIds = idObjectIds.filter((id) => !matchedIds.has(String(id)));
        if (remainingIds.length > 0) {
            const byId = await CompanyMember.find({
                companyId: cObjectId,
                _id: { $in: remainingIds },
            }).populate('userId roleId designationId');
            if (Array.isArray(byId)) {
                memberDocs.push(...byId);
                byId.forEach((m) => {
                    matchedIds.add(String(m._id));
                    const u = (m.userId as any)?._id || m.userId;
                    matchedIds.add(String(u));
                });
            }
        }

        const unauthorizedIds = ids.filter((id) => !matchedIds.has(id));
        if (unauthorizedIds.length > 0) {
            throw AppError.forbidden(
                `One or more employees do not belong to your company: ${unauthorizedIds.join(', ')}`
            );
        }

        // 2. Fetch company module access, features & entitlements
        const moduleAccessDoc = await this.getOrCreateCompanyModuleAccess(companyId);
        const companyFeatures = await FeatureAccessService.getCompanyFeatureFlags(companyId);

        const planEntitlements: Record<string, boolean> = {};
        for (const mod of SUPPORTED_MODULES) {
            if (mod.entitlement) {
                try {
                    const entDetails = await EntitlementService.getEntitlementDetails(
                        companyId,
                        mod.entitlement
                    );
                    planEntitlements[mod.key] = entDetails ? entDetails.enabled : false;
                } catch {
                    planEntitlements[mod.key] = false;
                }
            } else {
                planEntitlements[mod.key] = true;
            }
        }

        // 3. Compute effective access for each selected member
        const members: EffectiveEmployeeModuleAccess[] = memberDocs.map((member) => {
            const user = member.userId as any;
            const userIdStr = String(user?._id || member.userId);

            const empOverrideDoc = moduleAccessDoc.employeeOverrides.find(
                (o) => String(o.employeeId) === userIdStr
            );

            const rawOverrides: Record<string, OverrideState> = {};
            if (empOverrideDoc) {
                const map = empOverrideDoc.overrides as any;
                if (map instanceof Map) {
                    map.forEach((val, k) => {
                        rawOverrides[k] = val as OverrideState;
                    });
                } else if (typeof map === 'object' && map) {
                    Object.assign(rawOverrides, map);
                }
            }

            const overrides: Record<ModuleKey, OverrideState> = {} as any;
            const effectiveAccess: Record<ModuleKey, boolean> = {} as any;
            const featureRestrictions: any = {};
            let customOverrideCount = 0;

            SUPPORTED_MODULES.forEach((mod) => {
                const overrideState = resolveOverrideState(rawOverrides[mod.key]);
                overrides[mod.key] = overrideState;
                if (overrideState !== 'INHERIT') customOverrideCount++;

                const isPlanPermitted = planEntitlements[mod.key] ?? true;
                const isCompanyPermitted = mod.featureFlag
                    ? (companyFeatures[mod.featureFlag] ?? true)
                    : true;
                const isGloballyEnabled = moduleAccessDoc.globalSettings[mod.key] ?? true;

                featureRestrictions[mod.key] = {
                    disabledByPlan: !isPlanPermitted,
                    disabledByCompany: !isCompanyPermitted,
                };

                if (!isPlanPermitted || !isCompanyPermitted) {
                    effectiveAccess[mod.key] = false;
                } else if (overrideState === 'DISABLED') {
                    effectiveAccess[mod.key] = false;
                } else if (overrideState === 'ENABLED') {
                    effectiveAccess[mod.key] = true;
                } else {
                    effectiveAccess[mod.key] = isGloballyEnabled;
                }
            });

            return {
                employeeId: userIdStr,
                employeeName: user?.name || 'Member',
                employeeEmail: user?.email || '',
                avatar: user?.avatar || null,
                memberType: member.memberType,
                designationName: (member.designationId as any)?.name || 'Employee',
                roleName: (member.roleId as any)?.name || 'Member',
                overrideCount: customOverrideCount,
                overrides,
                effectiveAccess,
                globalSettings: moduleAccessDoc.globalSettings,
                featureRestrictions,
            };
        });

        // 4. Compute Aggregate State for each module across all selected members
        const aggregate: Record<ModuleKey, AggregateModuleState> = {} as any;
        let allEnabledModulesCount = 0;
        let allDisabledModulesCount = 0;
        let mixedModulesCount = 0;

        SUPPORTED_MODULES.forEach((mod) => {
            const isPlanPermitted = planEntitlements[mod.key] ?? true;
            const isCompanyPermitted = mod.featureFlag
                ? (companyFeatures[mod.featureFlag] ?? true)
                : true;

            let enabledCount = 0;
            let disabledCount = 0;

            members.forEach((m) => {
                if (m.effectiveAccess[mod.key]) {
                    enabledCount++;
                } else {
                    disabledCount++;
                }
            });

            let state: AggregateState;
            if (enabledCount === members.length && members.length > 0) {
                state = 'ALL_ENABLED';
                allEnabledModulesCount++;
            } else if (disabledCount === members.length && members.length > 0) {
                state = 'ALL_DISABLED';
                allDisabledModulesCount++;
            } else {
                state = 'MIXED';
                mixedModulesCount++;
            }

            const isCompanyRestricted = !isPlanPermitted || !isCompanyPermitted;
            let restrictionReason: string | null = null;
            if (!isPlanPermitted) {
                restrictionReason = 'Disabled by subscription plan';
            } else if (!isCompanyPermitted) {
                restrictionReason = 'Disabled by company feature setting';
            }

            aggregate[mod.key] = {
                moduleKey: mod.key,
                name: mod.name,
                state,
                enabledCount,
                disabledCount,
                totalCount: members.length,
                isCompanyRestricted,
                restrictionReason,
            };
        });

        return {
            members,
            aggregate,
            summary: {
                totalSelected: members.length,
                totalModules: SUPPORTED_MODULES.length,
                allEnabledModulesCount,
                allDisabledModulesCount,
                mixedModulesCount,
            },
        };
    }

    /**
     * Update individual employee module overrides
     */
    static async updateEmployeeModuleAccess(
        companyId: string,
        employeeId: string,
        dto: UpdateEmployeeOverrideDto,
        updatedBy?: string
    ) {
        // 1. Verify tenant membership (supports either userId or CompanyMember _id)
        const empObjectId = new Types.ObjectId(employeeId);
        let member = await CompanyMember.findOne({
            companyId: new Types.ObjectId(companyId),
            userId: empObjectId,
        });

        if (!member) {
            member = await CompanyMember.findOne({
                companyId: new Types.ObjectId(companyId),
                _id: empObjectId,
            });
        }

        if (!member) {
            throw AppError.notFound('Employee does not belong to this organization');
        }

        const canonicalUserId = String((member.userId as any)?._id || member.userId);
        const record = await this.getOrCreateCompanyModuleAccess(companyId);
        const userObjectId = new Types.ObjectId(canonicalUserId);

        let overrideEntry = record.employeeOverrides.find(
            (o) => String(o.employeeId) === canonicalUserId
        );

        if (!overrideEntry) {
            overrideEntry = {
                employeeId: userObjectId,
                overrides: new Map(),
                updatedAt: new Date(),
                updatedBy: updatedBy ? new Types.ObjectId(updatedBy) : null,
            };
            record.employeeOverrides.push(overrideEntry);
        }

        const overridesMap = overrideEntry.overrides instanceof Map
            ? overrideEntry.overrides
            : new Map(Object.entries(overrideEntry.overrides || {}));

        const changedKeys: ModuleKey[] = [];
        const sourceMap = dto.overrides || dto.modules || {};

        for (const [key, state] of Object.entries(sourceMap)) {
            const mKey = normalizeModuleKey(key);
            if (mKey) {
                let resolvedState: OverrideState = 'INHERIT';
                if (typeof state === 'boolean') {
                    resolvedState = state ? 'ENABLED' : 'DISABLED';
                } else if (typeof state === 'string') {
                    const upper = state.trim().toUpperCase();
                    if (['INHERIT', 'ENABLED', 'DISABLED'].includes(upper)) {
                        resolvedState = upper as OverrideState;
                    }
                }

                if (resolvedState === 'INHERIT') {
                    overridesMap.delete(mKey);
                } else {
                    overridesMap.set(mKey, resolvedState);
                }
                changedKeys.push(mKey);
            }
        }

        overrideEntry.overrides = overridesMap;
        overrideEntry.updatedAt = new Date();
        overrideEntry.updatedBy = updatedBy ? new Types.ObjectId(updatedBy) : null;

        // Clean up empty override entries
        if (overridesMap.size === 0) {
            record.employeeOverrides = record.employeeOverrides.filter(
                (o) => String(o.employeeId) !== canonicalUserId
            );
        }

        record.markModified('employeeOverrides');
        record.updatedBy = updatedBy ? new Types.ObjectId(updatedBy) : null;
        record.auditHistory.push({
            actorId: updatedBy ? new Types.ObjectId(updatedBy) : new Types.ObjectId(),
            action: 'EMPLOYEE_OVERRIDE_UPDATE',
            affectedModuleKeys: changedKeys,
            affectedEmployeeIds: [userObjectId],
            details: `Updated overrides for employee ${canonicalUserId}: ${changedKeys.join(', ')}`,
            timestamp: new Date(),
        });

        await record.save();

        // Invalidate cache and emit real-time sync event
        await this.invalidateMemberAccessCache(companyId, [canonicalUserId]);

        return this.getSingleEmployeeModuleAccess(companyId, canonicalUserId);
    }

    /**
     * Reset a single module override for an employee back to INHERIT
     */
    static async resetEmployeeOverride(
        companyId: string,
        employeeId: string,
        moduleKey: string,
        updatedBy?: string
    ) {
        const canonicalKey = normalizeModuleKey(moduleKey);
        if (!canonicalKey) {
            throw AppError.badRequest(`Invalid module key: ${moduleKey}`);
        }

        return this.updateEmployeeModuleAccess(
            companyId,
            employeeId,
            { overrides: { [canonicalKey]: 'INHERIT' } },
            updatedBy
        );
    }

    /**
     * Bulk update module overrides for multiple employees atomically
     */
    static async bulkUpdateEmployeeModuleAccess(
        companyId: string,
        dto: BulkUpdateEmployeeOverridesDto,
        updatedBy?: string
    ): Promise<BulkUpdateResult> {
        const rawIds = (dto.employeeIds || dto.memberIds || []).map((id) => String(id).trim());
        if (rawIds.length === 0) {
            throw AppError.badRequest('At least one employee or member ID must be provided');
        }

        const cObjectId = new Types.ObjectId(companyId);

        // 1. Verify tenant membership of ALL supplied IDs
        const rawObjectIds = rawIds.map((id) => new Types.ObjectId(id));
        const validMembers: any[] = [];
        const byUserId = await CompanyMember.find({
            companyId: cObjectId,
            userId: { $in: rawObjectIds },
        }).select('_id userId');

        if (Array.isArray(byUserId)) {
            validMembers.push(...byUserId);
        }

        const matchedMemberSet = new Set<string>();
        validMembers.forEach((m) => {
            matchedMemberSet.add(String(m._id));
            const u = (m.userId as any)?._id || m.userId;
            matchedMemberSet.add(String(u));
        });

        const remainingIds = rawObjectIds.filter((id) => !matchedMemberSet.has(String(id)));
        if (remainingIds.length > 0) {
            const byId = await CompanyMember.find({
                companyId: cObjectId,
                _id: { $in: remainingIds },
            }).select('_id userId');
            if (Array.isArray(byId)) {
                validMembers.push(...byId);
                byId.forEach((m) => {
                    matchedMemberSet.add(String(m._id));
                    const u = (m.userId as any)?._id || m.userId;
                    matchedMemberSet.add(String(u));
                });
            }
        }

        const unauthorizedIds = rawIds.filter((id) => !matchedMemberSet.has(id));
        if (unauthorizedIds.length > 0) {
            throw AppError.forbidden(
                `One or more employees do not belong to your company: ${unauthorizedIds.join(', ')}`
            );
        }

        // Map every selected target to their canonical User ID string
        const targetUserIds = Array.from(
            new Set(validMembers.map((m) => String((m.userId as any)?._id || m.userId)))
        );

        const record = await this.getOrCreateCompanyModuleAccess(companyId);
        const affectedModuleKeys: Set<ModuleKey> = new Set();

        // Determine what overrides to apply
        const overridesToApply: Record<ModuleKey, OverrideState> = {} as any;
        const { action, moduleKey, overrides, modules } = dto;

        if (action === 'ENABLE' && moduleKey) {
            const canonicalKey = normalizeModuleKey(moduleKey);
            if (canonicalKey) {
                overridesToApply[canonicalKey] = 'ENABLED';
                affectedModuleKeys.add(canonicalKey);
            }
        } else if (action === 'DISABLE' && moduleKey) {
            const canonicalKey = normalizeModuleKey(moduleKey);
            if (canonicalKey) {
                overridesToApply[canonicalKey] = 'DISABLED';
                affectedModuleKeys.add(canonicalKey);
            }
        } else if (action === 'RESET' && moduleKey) {
            const canonicalKey = normalizeModuleKey(moduleKey);
            if (canonicalKey) {
                overridesToApply[canonicalKey] = 'INHERIT';
                affectedModuleKeys.add(canonicalKey);
            }
        } else {
            const sourceMap = overrides || modules || {};
            for (const [k, v] of Object.entries(sourceMap)) {
                const canonicalKey = normalizeModuleKey(k);
                if (canonicalKey) {
                    let state: OverrideState = 'INHERIT';
                    if (typeof v === 'boolean') {
                        state = v ? 'ENABLED' : 'DISABLED';
                    } else if (typeof v === 'string') {
                        const upper = v.trim().toUpperCase();
                        if (['ENABLED', 'DISABLED', 'INHERIT'].includes(upper)) {
                            state = upper as OverrideState;
                        }
                    }
                    overridesToApply[canonicalKey] = state;
                    affectedModuleKeys.add(canonicalKey);
                }
            }
        }

        const empObjectIds = targetUserIds.map((id) => new Types.ObjectId(id));

        // Apply overrides to each target employee (preserving unspecified keys)
        for (const empId of targetUserIds) {
            let overrideEntry = record.employeeOverrides.find(
                (o) => String(o.employeeId) === String(empId)
            );

            if (!overrideEntry) {
                overrideEntry = {
                    employeeId: new Types.ObjectId(empId),
                    overrides: new Map(),
                    updatedAt: new Date(),
                    updatedBy: updatedBy ? new Types.ObjectId(updatedBy) : null,
                };
                record.employeeOverrides.push(overrideEntry);
            }

            const overridesMap = overrideEntry.overrides instanceof Map
                ? overrideEntry.overrides
                : new Map(Object.entries(overrideEntry.overrides || {}));

            for (const [k, state] of Object.entries(overridesToApply)) {
                const mKey = k as ModuleKey;
                if (state === 'INHERIT') {
                    overridesMap.delete(mKey);
                } else {
                    overridesMap.set(mKey, state);
                }
            }

            overrideEntry.overrides = overridesMap;
            overrideEntry.updatedAt = new Date();
            overrideEntry.updatedBy = updatedBy ? new Types.ObjectId(updatedBy) : null;
        }

        // Clean up empty override entries
        record.employeeOverrides = record.employeeOverrides.filter((o) => {
            const map = o.overrides instanceof Map ? o.overrides : new Map(Object.entries(o.overrides || {}));
            return map.size > 0;
        });

        record.markModified('employeeOverrides');
        record.updatedBy = updatedBy ? new Types.ObjectId(updatedBy) : null;
        record.auditHistory.push({
            actorId: updatedBy ? new Types.ObjectId(updatedBy) : new Types.ObjectId(),
            action: 'BULK_OVERRIDE_UPDATE',
            affectedModuleKeys: Array.from(affectedModuleKeys),
            affectedEmployeeIds: empObjectIds,
            details: `Bulk override update for ${targetUserIds.length} employees`,
            timestamp: new Date(),
        });

        await record.save();

        // Invalidate caches and broadcast real-time sync
        await this.invalidateMemberAccessCache(companyId, targetUserIds);

        // Fetch updated selected members access with aggregate stats
        const selectedResults = await this.getSelectedMembersModuleAccess(companyId, targetUserIds);

        return {
            success: true,
            affectedEmployeesCount: targetUserIds.length,
            affectedModuleKeys: Array.from(affectedModuleKeys),
            message: `Successfully updated module access for ${targetUserIds.length} employee(s)`,
            aggregate: selectedResults.aggregate,
            updatedEmployees: selectedResults.members,
        };
    }

    /**
     * Get effective module access for the currently logged-in member
     * Evaluates all 5 precedence tiers in order with Redis caching and real-time synchronization.
     */
    static async getEffectiveMemberModuleAccess(
        companyId: string,
        userId: string
    ): Promise<MemberEffectiveModuleAccessResponse> {
        const cacheKey = `worksphere:cache:module_access:${companyId}:${userId}`;
        const redis = getRedisClient();
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch {
                // Ignore cache read error
            }
        }

        const record = await this.getOrCreateCompanyModuleAccess(companyId);
        const companyFeatures = await FeatureAccessService.getCompanyFeatureFlags(companyId);

        // Find employee override record (supports matching either user ID or member document ID)
        let empOverride = record.employeeOverrides.find(
            (o) => String(o.employeeId) === String(userId)
        );

        if (!empOverride && Types.ObjectId.isValid(userId)) {
            const memberQuery: any = CompanyMember.findOne({
                companyId: new Types.ObjectId(companyId),
                userId: new Types.ObjectId(userId),
            });
            const memberDoc = typeof memberQuery?.lean === 'function'
                ? await memberQuery.lean()
                : await memberQuery;
            if (memberDoc) {
                const memberIdStr = String(memberDoc._id);
                empOverride = record.employeeOverrides.find(
                    (o) => String(o.employeeId) === memberIdStr
                );
            }
        }

        const rawOverrides: Record<string, any> = {};
        if (empOverride) {
            const map = empOverride.overrides as any;
            if (map instanceof Map) {
                map.forEach((val, k) => {
                    rawOverrides[k] = val;
                });
            } else if (typeof map === 'object' && map) {
                Object.assign(rawOverrides, map);
            }
        }

        const effectiveModules: Record<ModuleKey, boolean> = {} as any;

        for (const mod of SUPPORTED_MODULES) {
            // Tier 1: Plan / Subscription entitlement
            let isPermittedByPlan = true;
            if (mod.entitlement) {
                try {
                    const entDetails = await EntitlementService.getEntitlementDetails(
                        companyId,
                        mod.entitlement
                    );
                    if (entDetails && !entDetails.enabled) {
                        isPermittedByPlan = false;
                    }
                } catch {
                    isPermittedByPlan = false;
                }
            }

            // Tier 2: Company-level Feature Toggle
            let isCompanyPermitted = true;
            if (mod.featureFlag) {
                isCompanyPermitted = companyFeatures[mod.featureFlag] ?? true;
            }

            // Tier 3: Company Global Module Setting
            const isGloballyEnabled = record.globalSettings[mod.key] ?? true;

            // Tier 4: Employee Override (Safely resolved without falsy coercion)
            const employeeOverride = resolveOverrideState(rawOverrides[mod.key]);

            // Tier 5: Combined Precedence Resolution
            // Rule: Mandatory restrictions (Tier 1 & 2) always supersede.
            // If permitted by plan & company:
            //   - Explicit member override (ENABLED / DISABLED) takes precedence.
            //   - Otherwise, fall back to global company default.
            if (!isPermittedByPlan || !isCompanyPermitted) {
                effectiveModules[mod.key] = false;
            } else if (employeeOverride === 'DISABLED') {
                effectiveModules[mod.key] = false;
            } else if (employeeOverride === 'ENABLED') {
                effectiveModules[mod.key] = true;
            } else {
                effectiveModules[mod.key] = isGloballyEnabled;
            }
        }

        const result: MemberEffectiveModuleAccessResponse = {
            effectiveModules,
            modulesMetadata: SUPPORTED_MODULES,
        };

        if (redis) {
            try {
                await redis.setex(cacheKey, 60, JSON.stringify(result));
            } catch {
                // Ignore cache write error
            }
        }

        return result;
    }
}
