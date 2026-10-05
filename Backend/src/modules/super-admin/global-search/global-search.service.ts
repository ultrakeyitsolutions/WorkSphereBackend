/**
 * WorkSphere Global Search Service — Unified, Role-Aware Search Engine
 *
 * Architecture & Design:
 *  1. Atlas Search ($search) is the primary engine for high-relevance,
 *     fuzzy, and token-order aware matching across:
 *     - Companies (name, slug, domain)
 *     - Projects (name)
 *     - Users / Members (name, email, designation)
 *     - Tasks (title, taskNumber, ticketId)
 *
 *  2. Role & Authorization Scopes:
 *     - SUPER_ADMIN: Global search across Companies, Projects, Members, and Tasks.
 *     - COMPANY_ADMIN: Company-scoped search across Projects, Members, and Tasks (no companies).
 *     - EMPLOYEE / MEMBER: Project-scoped search across authorized Projects and Tasks (no companies or members).
 *       Accessible projects are strictly resolved from ProjectTeamMember, ProjectInCharge,
 *       and created projects (identical to DashboardScopeService).
 *
 *  3. Cache Partitioning:
 *     - Keys are strictly partitioned by role & company/user to prevent cross-tenant data leakage:
 *       SuperAdmin:   superadmin:global-search:superadmin:<query>:<cursor>
 *       CompanyAdmin: superadmin:global-search:company:<companyId>:<query>:<cursor>
 *       Employee:     superadmin:global-search:employee:<companyId>:<userId>:<query>:<cursor>
 *
 *  4. Zero N+1 Queries:
 *     - Company & Project context enrichment is performed via single batched queries and Map lookups.
 *
 *  5. Graceful Fallback:
 *     - If MongoDB Atlas Search index ($search) is not provisioned or throws IndexNotFound,
 *       bounded regex fallback queries execute transparently without failing the request.
 */

import mongoose, { Types, PipelineStage } from 'mongoose';
import { performance } from 'perf_hooks';
import { Company } from '../companies/company.model';
import { User } from '../../users/user.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import CompanyMember from '../../companyadmin/invitations/company-member.model';
import Designation from '../../companyadmin/invitations/designation/designation.model';
import { redisGet, redisSet } from '../../../config/redis';
import { AppError } from '../../../utils/AppError';
import {
    CACHE_KEY_PREFIX,
    CACHE_TTL_SECONDS,
    COMPANIES_RESULT_CAP,
    PROJECTS_RESULT_CAP,
    MEMBERS_RESULT_CAP,
    TASKS_RESULT_CAP,
} from './global-search.validator';

// ─── Response shape types ─────────────────────────────────────────────────────

export interface CompanySearchResult {
    id: string;
    name: string;
    slug: string;
    domain?: string;
    status: string;
}

export interface ProjectSearchResult {
    id: string;
    name: string;
    status: string;
    company: {
        id: string;
        name: string;
        slug: string;
    } | null;
}

export interface MemberSearchResult {
    id: string;
    name: string;
    email: string;
    memberType: string;
    designation: string | null;
    company: {
        id: string;
        name: string;
        slug: string;
    } | null;
}

export interface TaskSearchResult {
    id: string;
    title: string;
    taskNumber?: string;
    ticketId?: string;
    priority?: string;
    taskType?: string;
    projectId: string;
    project?: {
        id: string;
        name: string;
    } | null;
    company?: {
        id: string;
        name: string;
        slug: string;
    } | null;
}

export interface GlobalSearchGroups {
    companies?: { total: number; results: CompanySearchResult[] };
    projects: { total: number; results: ProjectSearchResult[] };
    members?: { total: number; results: MemberSearchResult[] };
    employees?: { total: number; results: MemberSearchResult[] };
    tasks: { total: number; results: TaskSearchResult[] };
}

export interface GlobalSearchResult {
    query: string;
    groups: GlobalSearchGroups;
    hasMore: boolean;
    nextCursor?: string;
    meta: {
        cacheHit: boolean;
        searchMs: number;
        totalMs: number;
    };
}

export interface SearchScopeContext {
    role: string;
    userId: string;
    isSuperAdmin: boolean;
    isCompanyAdmin: boolean;
    isEmployee: boolean;
    companyId?: Types.ObjectId;
    accessibleProjectIds?: Types.ObjectId[];
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────

interface CursorPayload {
    score: number;
    id: string;
    group: 'companies' | 'projects' | 'members' | 'tasks';
    page: number;
}

function encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(token: string): CursorPayload | null {
    try {
        return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

// ─── Atlas Search pipeline builder ───────────────────────────────────────────

function buildAtlasSearchStage(
    query: string,
    fields: string[],
    indexName = 'globalSearch'
): PipelineStage {
    const shouldClauses: unknown[] = fields.flatMap((field) => [
        {
            text: {
                query,
                path: field,
                score: { boost: { value: 5 } },
            },
        },
        {
            autocomplete: {
                query,
                path: field,
                tokenOrder: 'sequential',
                score: { boost: { value: 3 } },
            },
        },
        {
            text: {
                query,
                path: field,
                fuzzy: { maxEdits: 1, prefixLength: 2 },
            },
        },
    ]);

    return {
        $search: {
            index: indexName,
            compound: {
                should: shouldClauses,
                minimumShouldMatch: 1,
            },
            returnStoredSource: false,
        },
    } as unknown as PipelineStage;
}

// ─── Fallback regex search ────────────────────────────────────────────────────

function buildRegexSearchStage(query: string, fields: string[]): Record<string, unknown> {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedQuery}`, 'i');

    return {
        $or: fields.map((f) => ({ [f]: { $regex: regex } })),
    };
}

// ─── Main search service ──────────────────────────────────────────────────────

export class GlobalSearchService {
    /**
     * Resolve the search scope from the authenticated user context.
     * Enforces strict server-side authorization boundaries.
     */
    public static async resolveScope(
        user?: { userId?: string; role?: string; companyId?: string }
    ): Promise<SearchScopeContext> {
        if (!user || !user.userId) {
            // Default to SuperAdmin if no explicit user context (maintains backwards compatibility)
            return {
                role: 'SUPER_ADMIN',
                userId: '',
                isSuperAdmin: true,
                isCompanyAdmin: false,
                isEmployee: false,
            };
        }

        const role = (user.role || '').toUpperCase();
        const userId = user.userId;

        if (role === 'SUPER_ADMIN') {
            return {
                role: 'SUPER_ADMIN',
                userId,
                isSuperAdmin: true,
                isCompanyAdmin: false,
                isEmployee: false,
            };
        }

        // For non-SuperAdmin, resolve companyId strictly
        let companyIdStr = user.companyId;
        if (!companyIdStr && Types.ObjectId.isValid(userId)) {
            const userDoc = await User.findById(userId).select('companyId').lean();
            companyIdStr = userDoc?.companyId ? String(userDoc.companyId) : undefined;
        }

        if (!companyIdStr || !Types.ObjectId.isValid(companyIdStr)) {
            throw AppError.unauthorized('Unauthorized: Valid company context is required');
        }

        const companyId = new Types.ObjectId(companyIdStr);
        const userObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;

        const isCompanyAdmin = role === 'COMPANY_ADMIN' || role === 'ADMIN';

        if (isCompanyAdmin) {
            return {
                role: 'COMPANY_ADMIN',
                userId,
                isSuperAdmin: false,
                isCompanyAdmin: true,
                isEmployee: false,
                companyId,
            };
        }

        // Employee / Member / Developer / Manager: Resolve accessible project IDs
        let accessibleProjectIds: Types.ObjectId[] = [];
        if (userObjId) {
            const [teamMemberships, inCharges, createdProjects] = await Promise.all([
                ProjectTeamMember.find({ userId: userObjId }).select('projectId').lean(),
                ProjectInCharge.find({ userId: userObjId }).select('projectId').lean(),
                Project.find({ companyId, createdById: userObjId, deletedAt: null }).select('_id').lean(),
            ]);

            const pIdSet = new Set<string>();
            teamMemberships.forEach((m) => m.projectId && pIdSet.add(String(m.projectId)));
            inCharges.forEach((m) => m.projectId && pIdSet.add(String(m.projectId)));
            createdProjects.forEach((p) => p._id && pIdSet.add(String(p._id)));

            accessibleProjectIds = Array.from(pIdSet).map((id) => new Types.ObjectId(id));
        }

        return {
            role,
            userId,
            isSuperAdmin: false,
            isCompanyAdmin: false,
            isEmployee: true,
            companyId,
            accessibleProjectIds,
        };
    }

    /**
     * Execute global search across Companies, Projects, Members, and Tasks.
     *
     * @param rawQuery    - Normalised query string (already trimmed by Zod)
     * @param _limit      - Maximum total results (capped per group internally)
     * @param cursor      - Opaque pagination cursor from a previous response
     * @param userContext - Authenticated user context
     */
    static async search(
        rawQuery: string,
        _limit: number,
        cursor?: string,
        userContext?: { userId?: string; role?: string; companyId?: string }
    ): Promise<GlobalSearchResult> {
        const totalStart = performance.now();
        const query = rawQuery.trim();

        const scope = await GlobalSearchService.resolveScope(userContext);

        // ── Cache key ─────────────────────────────────────────────────────────
        let cacheKeyScope = 'superadmin';
        if (scope.isCompanyAdmin && scope.companyId) {
            cacheKeyScope = `company:${scope.companyId}`;
        } else if (scope.isEmployee && scope.companyId) {
            cacheKeyScope = `employee:${scope.companyId}:${scope.userId}`;
        }
        const cacheKey = `${CACHE_KEY_PREFIX}:${cacheKeyScope}:${query}:${cursor ?? 'p1'}`;

        // ── Cache lookup ──────────────────────────────────────────────────────
        let cached: string | null = null;
        try {
            cached = await redisGet(cacheKey);
        } catch {
            // Redis error — proceed with direct DB search
        }

        if (cached) {
            try {
                const parsed = JSON.parse(cached) as GlobalSearchResult;
                parsed.meta.cacheHit = true;
                parsed.meta.totalMs = Math.round(performance.now() - totalStart);
                return parsed;
            } catch {
                // Corrupted cache entry — fall through
            }
        }

        // ── Decode pagination cursor ──────────────────────────────────────────
        const cursorPayload = cursor ? decodeCursor(cursor) : null;
        const pageOffset = cursorPayload?.page ?? 0;

        // ── Parallel searches ─────────────────────────────────────────────────
        const searchStart = performance.now();

        const [companyResult, projectResult, memberResult, taskResult] = await Promise.all([
            GlobalSearchService.searchCompanies(query, pageOffset, scope),
            GlobalSearchService.searchProjects(query, pageOffset, scope),
            GlobalSearchService.searchMembers(query, pageOffset, scope),
            GlobalSearchService.searchTasks(query, pageOffset, scope),
        ]);

        const searchMs = Math.round(performance.now() - searchStart);

        // ── Determine hasMore and nextCursor ──────────────────────────────────
        const hasMore =
            companyResult.hasMore ||
            projectResult.hasMore ||
            memberResult.hasMore ||
            taskResult.hasMore;

        let nextCursor: string | undefined;
        if (hasMore) {
            const nextGroup = companyResult.hasMore
                ? 'companies'
                : projectResult.hasMore
                  ? 'projects'
                  : memberResult.hasMore
                    ? 'members'
                    : 'tasks';

            nextCursor = encodeCursor({
                score: 0,
                id: '',
                group: nextGroup,
                page: pageOffset + 1,
            });
        }

        // ── Assemble result ───────────────────────────────────────────────────
        const result: GlobalSearchResult = {
            query,
            groups: {
                companies: {
                    total: companyResult.total,
                    results: companyResult.results,
                },
                projects: {
                    total: projectResult.total,
                    results: projectResult.results,
                },
                members: {
                    total: memberResult.total,
                    results: memberResult.results,
                },
                employees: {
                    total: memberResult.total,
                    results: memberResult.results,
                },
                tasks: {
                    total: taskResult.total,
                    results: taskResult.results,
                },
            },
            hasMore,
            nextCursor,
            meta: {
                cacheHit: false,
                searchMs,
                totalMs: Math.round(performance.now() - totalStart),
            },
        };

        // Log performance (non-sensitive)
        console.info(
            `[GlobalSearch] role=${scope.role} query="${query}" cache=MISS search=${searchMs}ms total=${result.meta.totalMs}ms ` +
                `companies=${companyResult.results.length}/${companyResult.total} ` +
                `projects=${projectResult.results.length}/${projectResult.total} ` +
                `members=${memberResult.results.length}/${memberResult.total} ` +
                `tasks=${taskResult.results.length}/${taskResult.total}`
        );

        // ── Store in Redis ────────────────────────────────────────────────────
        try {
            await redisSet(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
        } catch {
            // Non-fatal cache failure
        }

        return result;
    }

    // ── Company search ────────────────────────────────────────────────────────

    private static async searchCompanies(
        query: string,
        pageOffset: number,
        scope: SearchScopeContext
    ): Promise<{ results: CompanySearchResult[]; total: number; hasMore: boolean }> {
        // Only SUPER_ADMIN can search companies
        if (!scope.isSuperAdmin) {
            return { results: [], total: 0, hasMore: false };
        }

        const CAP = COMPANIES_RESULT_CAP;
        const skip = pageOffset * CAP;

        try {
            const pipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name', 'slug', 'domain']),
                {
                    $match: {
                        status: { $nin: ['DELETED' as const] },
                        isActive: true,
                    },
                } as PipelineStage,
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        slug: 1,
                        domain: 1,
                        status: 1,
                        score: { $meta: 'searchScore' },
                    },
                } as PipelineStage,
                { $sort: { score: -1, _id: 1 } } as PipelineStage,
                { $skip: skip } as PipelineStage,
                { $limit: CAP + 1 } as PipelineStage,
            ];

            const raw = await Company.aggregate(pipeline);
            const hasMore = raw.length > CAP;
            const docs = raw.slice(0, CAP);

            const countPipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name', 'slug', 'domain']),
                { $match: { status: { $nin: ['DELETED' as const] }, isActive: true } } as PipelineStage,
                { $count: 'n' } as PipelineStage,
            ];
            const countResult = await Company.aggregate(countPipeline);
            const total = countResult[0]?.n ?? docs.length;

            return {
                results: docs.map((c) => ({
                    id: String(c._id),
                    name: c.name,
                    slug: c.slug,
                    domain: c.domain,
                    status: c.status,
                })),
                total,
                hasMore,
            };
        } catch (err: any) {
            if (
                err?.codeName === 'IndexNotFound' ||
                err?.message?.includes('$search') ||
                err?.code === 40324
            ) {
                console.warn('[GlobalSearch] Atlas Search unavailable for companies, using regex fallback');
                return GlobalSearchService.searchCompaniesFallback(query, skip, CAP);
            }
            throw err;
        }
    }

    private static async searchCompaniesFallback(
        query: string,
        skip: number,
        cap: number
    ): Promise<{ results: CompanySearchResult[]; total: number; hasMore: boolean }> {
        const regexFilter = buildRegexSearchStage(query, ['name', 'slug', 'domain']);
        const filter = {
            ...regexFilter,
            status: { $ne: 'DELETED' },
            isActive: true,
        };

        const [docs, total] = await Promise.all([
            Company.find(filter as any)
                .select('name slug domain status')
                .skip(skip)
                .limit(cap + 1)
                .lean(),
            Company.countDocuments(filter as any),
        ]);

        const hasMore = docs.length > cap;
        return {
            results: docs.slice(0, cap).map((c: any) => ({
                id: String(c._id),
                name: c.name,
                slug: c.slug,
                domain: c.domain,
                status: c.status,
            })),
            total,
            hasMore,
        };
    }

    // ── Project search ────────────────────────────────────────────────────────

    private static async searchProjects(
        query: string,
        pageOffset: number,
        scope: SearchScopeContext
    ): Promise<{ results: ProjectSearchResult[]; total: number; hasMore: boolean }> {
        const CAP = PROJECTS_RESULT_CAP;
        const skip = pageOffset * CAP;

        // If employee has zero assigned projects, return immediately
        if (scope.isEmployee && (!scope.accessibleProjectIds || scope.accessibleProjectIds.length === 0)) {
            return { results: [], total: 0, hasMore: false };
        }

        const matchCondition: Record<string, any> = {
            deletedAt: null,
        };

        if (scope.isCompanyAdmin && scope.companyId) {
            matchCondition.companyId = scope.companyId;
        } else if (scope.isEmployee && scope.companyId && scope.accessibleProjectIds) {
            matchCondition.companyId = scope.companyId;
            matchCondition._id = { $in: scope.accessibleProjectIds };
        }

        try {
            const pipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name']),
                { $match: matchCondition } as PipelineStage,
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        companyId: 1,
                        status: 1,
                        score: { $meta: 'searchScore' },
                    },
                } as PipelineStage,
                { $sort: { score: -1, _id: 1 } } as PipelineStage,
                { $skip: skip } as PipelineStage,
                { $limit: CAP + 1 } as PipelineStage,
            ];

            const raw = await Project.aggregate(pipeline);
            const hasMore = raw.length > CAP;
            const docs = raw.slice(0, CAP);

            const countPipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name']),
                { $match: matchCondition } as PipelineStage,
                { $count: 'n' } as PipelineStage,
            ];
            const countResult = await Project.aggregate(countPipeline);
            const total = countResult[0]?.n ?? docs.length;

            const companyIds = [
                ...new Set(docs.map((d) => String(d.companyId)).filter(Boolean)),
            ];
            const companyMap = await GlobalSearchService.fetchCompanyMap(companyIds);

            return {
                results: docs.map((p) => ({
                    id: String(p._id),
                    name: p.name,
                    status: p.status,
                    company: companyMap.get(String(p.companyId)) ?? null,
                })),
                total,
                hasMore,
            };
        } catch (err: any) {
            if (
                err?.codeName === 'IndexNotFound' ||
                err?.message?.includes('$search') ||
                err?.code === 40324
            ) {
                console.warn('[GlobalSearch] Atlas Search unavailable for projects, using regex fallback');
                return GlobalSearchService.searchProjectsFallback(query, skip, CAP, matchCondition);
            }
            throw err;
        }
    }

    private static async searchProjectsFallback(
        query: string,
        skip: number,
        cap: number,
        scopeMatch: Record<string, any>
    ): Promise<{ results: ProjectSearchResult[]; total: number; hasMore: boolean }> {
        const regexFilter = buildRegexSearchStage(query, ['name']);
        const filter = {
            ...regexFilter,
            ...scopeMatch,
        };

        const [docs, total] = await Promise.all([
            Project.find(filter as any)
                .select('name companyId status')
                .skip(skip)
                .limit(cap + 1)
                .lean(),
            Project.countDocuments(filter as any),
        ]);

        const hasMore = docs.length > cap;
        const sliced = docs.slice(0, cap);

        const companyIds = [
            ...new Set(sliced.map((d: any) => String(d.companyId)).filter(Boolean)),
        ];
        const companyMap = await GlobalSearchService.fetchCompanyMap(companyIds);

        return {
            results: sliced.map((p: any) => ({
                id: String(p._id),
                name: p.name,
                status: p.status,
                company: companyMap.get(String(p.companyId)) ?? null,
            })),
            total,
            hasMore,
        };
    }

    // ── Member / Employee search ───────────────────────────────────────────────

    private static async searchMembers(
        query: string,
        pageOffset: number,
        scope: SearchScopeContext
    ): Promise<{ results: MemberSearchResult[]; total: number; hasMore: boolean }> {
        // Employees cannot search members/employees
        if (scope.isEmployee) {
            return { results: [], total: 0, hasMore: false };
        }

        const CAP = MEMBERS_RESULT_CAP;
        const skip = pageOffset * CAP;

        const matchCondition: Record<string, any> = {
            status: { $nin: ['DEACTIVATED' as const] },
        };

        if (scope.isSuperAdmin) {
            matchCondition.companyId = { $ne: null };
        } else if (scope.companyId) {
            matchCondition.companyId = scope.companyId;
        }

        let userIds: Types.ObjectId[] = [];
        let total = 0;
        let hasMore = false;

        try {
            const pipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name', 'email']),
                { $match: matchCondition } as PipelineStage,
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        email: 1,
                        companyId: 1,
                        score: { $meta: 'searchScore' },
                    },
                } as PipelineStage,
                { $sort: { score: -1, _id: 1 } } as PipelineStage,
                { $skip: skip } as PipelineStage,
                { $limit: CAP + 1 } as PipelineStage,
            ];

            const raw = await User.aggregate(pipeline);
            hasMore = raw.length > CAP;
            const docs = raw.slice(0, CAP);

            const countPipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['name', 'email']),
                { $match: matchCondition } as PipelineStage,
                { $count: 'n' } as PipelineStage,
            ];
            const countResult = await User.aggregate(countPipeline);
            total = countResult[0]?.n ?? docs.length;

            userIds = docs.map((u) => u._id as Types.ObjectId);

            return await GlobalSearchService.buildMemberResults(
                userIds,
                total,
                hasMore,
                pageOffset,
                query,
                scope
            );
        } catch (err: any) {
            if (
                err?.codeName === 'IndexNotFound' ||
                err?.message?.includes('$search') ||
                err?.code === 40324
            ) {
                console.warn('[GlobalSearch] Atlas Search unavailable for users, using regex fallback');
                return GlobalSearchService.searchMembersFallback(query, skip, CAP, matchCondition, scope);
            }
            throw err;
        }
    }

    private static async buildMemberResults(
        userIds: Types.ObjectId[],
        total: number,
        hasMore: boolean,
        pageOffset: number,
        query: string,
        scope: SearchScopeContext
    ): Promise<{ results: MemberSearchResult[]; total: number; hasMore: boolean }> {
        if (userIds.length === 0) {
            return { results: [], total: 0, hasMore: false };
        }

        const users = await User.find({ _id: { $in: userIds } })
            .select('name email companyId status')
            .lean();

        const memberRecords = await CompanyMember.find({
            userId: { $in: userIds },
            status: { $ne: 'SUSPENDED' },
            ...(scope.companyId && { companyId: scope.companyId }),
        })
            .select('userId companyId designationId memberType status')
            .lean();

        const memberByUserId = new Map<string, (typeof memberRecords)[0]>();
        for (const m of memberRecords) {
            memberByUserId.set(String(m.userId), m);
        }

        const designationIds = [
            ...new Set(
                memberRecords
                    .map((m) => String(m.designationId))
                    .filter(Boolean)
            ),
        ];

        const designations = designationIds.length
            ? await Designation.find({
                  _id: { $in: designationIds },
              })
                  .select('name')
                  .lean()
            : [];

        const designationMap = new Map<string, string>();
        for (const d of designations) {
            designationMap.set(String(d._id), d.name);
        }

        const companyIds = [
            ...new Set(
                memberRecords
                    .map((m) => String(m.companyId))
                    .filter(Boolean)
            ),
        ];
        const companyMap = await GlobalSearchService.fetchCompanyMap(companyIds);

        // Also check designation search
        const extraUserIds = await GlobalSearchService.findUsersByDesignationName(
            query,
            pageOffset,
            scope.companyId
        );
        const allUserIds = [
            ...new Set([...userIds.map((id) => String(id)), ...extraUserIds]),
        ];

        const allUsers =
            extraUserIds.length > 0
                ? await User.find({ _id: { $in: allUserIds } })
                      .select('name email companyId status')
                      .lean()
                : users;

        const userIdOrder = new Map<string, number>();
        userIds.forEach((id, i) => userIdOrder.set(String(id), i));

        const sortedUsers = [...allUsers].sort((a, b) => {
            const ai = userIdOrder.get(String(a._id)) ?? 999;
            const bi = userIdOrder.get(String(b._id)) ?? 999;
            return ai - bi;
        });

        const results: MemberSearchResult[] = sortedUsers
            .filter((u: any) => u.status !== 'DEACTIVATED')
            .map((u: any) => {
                const memberId = String(u._id);
                const member = memberByUserId.get(memberId);
                const designationName = member?.designationId
                    ? (designationMap.get(String(member.designationId)) ?? null)
                    : null;
                const company = member?.companyId
                    ? (companyMap.get(String(member.companyId)) ?? null)
                    : null;

                return {
                    id: memberId,
                    name: u.name,
                    email: u.email,
                    memberType: member?.memberType ?? 'EMPLOYEE',
                    designation: designationName,
                    company,
                };
            });

        return {
            results: results.slice(0, MEMBERS_RESULT_CAP),
            total: Math.max(total, results.length),
            hasMore: hasMore || results.length > MEMBERS_RESULT_CAP,
        };
    }

    private static async findUsersByDesignationName(
        query: string,
        pageOffset: number,
        companyId?: Types.ObjectId
    ): Promise<string[]> {
        try {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^${escaped}`, 'i');

            const matchingDesignations = await Designation.find({
                name: { $regex: regex },
                isActive: true,
                ...(companyId && { companyId }),
            })
                .select('_id')
                .limit(20)
                .lean();

            if (matchingDesignations.length === 0) return [];

            const desigIds = matchingDesignations.map((d) => d._id);
            const members = await CompanyMember.find({
                designationId: { $in: desigIds },
                status: { $ne: 'SUSPENDED' },
                ...(companyId && { companyId }),
            })
                .select('userId')
                .skip(pageOffset * MEMBERS_RESULT_CAP)
                .limit(MEMBERS_RESULT_CAP)
                .lean();

            return members.map((m) => String(m.userId));
        } catch {
            return [];
        }
    }

    private static async searchMembersFallback(
        query: string,
        skip: number,
        cap: number,
        matchCondition: Record<string, any>,
        scope: SearchScopeContext
    ): Promise<{ results: MemberSearchResult[]; total: number; hasMore: boolean }> {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escaped}`, 'i');

        const filter = {
            $or: [{ name: { $regex: regex } }, { email: { $regex: regex } }],
            ...matchCondition,
        };

        const [docs, total] = await Promise.all([
            User.find(filter as any)
                .select('name email companyId status')
                .skip(skip)
                .limit(cap + 1)
                .lean(),
            User.countDocuments(filter as any),
        ]);

        const hasMore = docs.length > cap;
        const sliced = docs.slice(0, cap) as any[];
        const userIds = sliced.map((u) => u._id as Types.ObjectId);

        return GlobalSearchService.buildMemberResults(
            userIds,
            total,
            hasMore,
            Math.floor(skip / cap),
            query,
            scope
        );
    }

    // ── Task search ───────────────────────────────────────────────────────────

    private static async searchTasks(
        query: string,
        pageOffset: number,
        scope: SearchScopeContext
    ): Promise<{ results: TaskSearchResult[]; total: number; hasMore: boolean }> {
        const CAP = TASKS_RESULT_CAP;
        const skip = pageOffset * CAP;

        // If employee has zero assigned projects, return immediately
        if (scope.isEmployee && (!scope.accessibleProjectIds || scope.accessibleProjectIds.length === 0)) {
            return { results: [], total: 0, hasMore: false };
        }

        const matchCondition: Record<string, any> = {
            isArchived: false,
        };

        if (scope.isCompanyAdmin && scope.companyId) {
            matchCondition.companyId = scope.companyId;
        } else if (scope.isEmployee && scope.companyId && scope.accessibleProjectIds) {
            matchCondition.companyId = scope.companyId;
            matchCondition.projectId = { $in: scope.accessibleProjectIds };
        }

        try {
            const pipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['title', 'taskNumber', 'ticketId']),
                { $match: matchCondition } as PipelineStage,
                {
                    $project: {
                        _id: 1,
                        title: 1,
                        taskNumber: 1,
                        ticketId: 1,
                        priority: 1,
                        taskType: 1,
                        projectId: 1,
                        companyId: 1,
                        score: { $meta: 'searchScore' },
                    },
                } as PipelineStage,
                { $sort: { score: -1, _id: 1 } } as PipelineStage,
                { $skip: skip } as PipelineStage,
                { $limit: CAP + 1 } as PipelineStage,
            ];

            const raw = await Task.aggregate(pipeline);
            const hasMore = raw.length > CAP;
            const docs = raw.slice(0, CAP);

            const countPipeline: PipelineStage[] = [
                buildAtlasSearchStage(query, ['title', 'taskNumber', 'ticketId']),
                { $match: matchCondition } as PipelineStage,
                { $count: 'n' } as PipelineStage,
            ];
            const countResult = await Task.aggregate(countPipeline);
            const total = countResult[0]?.n ?? docs.length;

            return await GlobalSearchService.buildTaskResults(docs, total, hasMore);
        } catch (err: any) {
            if (
                err?.codeName === 'IndexNotFound' ||
                err?.message?.includes('$search') ||
                err?.code === 40324
            ) {
                console.warn('[GlobalSearch] Atlas Search unavailable for tasks, using regex fallback');
                return GlobalSearchService.searchTasksFallback(query, skip, CAP, matchCondition);
            }
            throw err;
        }
    }

    private static async searchTasksFallback(
        query: string,
        skip: number,
        cap: number,
        scopeMatch: Record<string, any>
    ): Promise<{ results: TaskSearchResult[]; total: number; hasMore: boolean }> {
        const regexFilter = buildRegexSearchStage(query, ['title', 'taskNumber', 'ticketId']);
        const filter = {
            ...regexFilter,
            ...scopeMatch,
        };

        const [docs, total] = await Promise.all([
            Task.find(filter as any)
                .select('title taskNumber ticketId priority taskType projectId companyId')
                .skip(skip)
                .limit(cap + 1)
                .lean(),
            Task.countDocuments(filter as any),
        ]);

        const hasMore = docs.length > cap;
        const sliced = docs.slice(0, cap);

        return GlobalSearchService.buildTaskResults(sliced, total, hasMore);
    }

    private static async buildTaskResults(
        docs: any[],
        total: number,
        hasMore: boolean
    ): Promise<{ results: TaskSearchResult[]; total: number; hasMore: boolean }> {
        if (docs.length === 0) {
            return { results: [], total, hasMore };
        }

        const projectIds = [
            ...new Set(docs.map((d) => String(d.projectId)).filter(Boolean)),
        ];
        const companyIds = [
            ...new Set(docs.map((d) => String(d.companyId)).filter(Boolean)),
        ];

        const [projectMap, companyMap] = await Promise.all([
            GlobalSearchService.fetchProjectMap(projectIds),
            GlobalSearchService.fetchCompanyMap(companyIds),
        ]);

        return {
            results: docs.map((t) => ({
                id: String(t._id),
                title: t.title,
                taskNumber: t.taskNumber,
                ticketId: t.ticketId,
                priority: t.priority,
                taskType: t.taskType,
                projectId: String(t.projectId),
                project: projectMap.get(String(t.projectId)) ?? null,
                company: companyMap.get(String(t.companyId)) ?? null,
            })),
            total,
            hasMore,
        };
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    private static async fetchProjectMap(
        projectIds: string[]
    ): Promise<Map<string, { id: string; name: string }>> {
        const map = new Map<string, { id: string; name: string }>();
        if (projectIds.length === 0) return map;

        const objectIds = projectIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        if (objectIds.length === 0) return map;

        try {
            const projects = await Project.find({ _id: { $in: objectIds } })
                .select('name')
                .lean();

            for (const p of projects as any[]) {
                map.set(String(p._id), {
                    id: String(p._id),
                    name: p.name,
                });
            }
        } catch {
            // Non-critical
        }
        return map;
    }

    private static async fetchCompanyMap(
        companyIds: string[]
    ): Promise<Map<string, { id: string; name: string; slug: string }>> {
        if (companyIds.length === 0) return new Map();

        const objectIds = companyIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        if (objectIds.length === 0) return new Map();

        const companies = await Company.find({ _id: { $in: objectIds } })
            .select('name slug')
            .lean();

        const map = new Map<string, { id: string; name: string; slug: string }>();
        for (const c of companies as any[]) {
            map.set(String(c._id), {
                id: String(c._id),
                name: c.name,
                slug: c.slug,
            });
        }
        return map;
    }
}
