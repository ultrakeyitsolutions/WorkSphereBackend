/**
 * Zod validation schema for the SuperAdmin Global Search endpoint.
 *
 * GET /api/superadmin/global-search?q=kiran&limit=20&cursor=...
 *
 * Rules (kept in constants so they can be referenced in tests):
 *  - q (query): required, 2–100 characters after trim
 *  - limit: optional, 1–50, defaults to 20
 *  - cursor: optional opaque pagination token
 */

import { z } from 'zod';

// ── Exported constants (avoid magic numbers spread across files) ──────────────
export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 100;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;

// ── Per-group top-K result caps ───────────────────────────────────────────────
export const COMPANIES_RESULT_CAP = 5;
export const PROJECTS_RESULT_CAP = 5;
export const MEMBERS_RESULT_CAP = 10;
export const TASKS_RESULT_CAP = 10;

// ── Cache configuration ───────────────────────────────────────────────────────
export const CACHE_TTL_SECONDS = 45;
export const CACHE_KEY_PREFIX = 'superadmin:global-search';

// ── Zod schema ────────────────────────────────────────────────────────────────
export const globalSearchQuerySchema = z.object({
    query: z.object({
        q: z
            .string({ message: 'Search query "q" is required' })
            .trim()
            .min(SEARCH_QUERY_MIN, {
                message: `Search query must be at least ${SEARCH_QUERY_MIN} characters`,
            })
            .max(SEARCH_QUERY_MAX, {
                message: `Search query must be at most ${SEARCH_QUERY_MAX} characters`,
            }),

        limit: z
            .string()
            .optional()
            .transform((val) => {
                if (!val) return SEARCH_LIMIT_DEFAULT;
                const n = parseInt(val, 10);
                if (isNaN(n) || n < 1) return SEARCH_LIMIT_DEFAULT;
                return Math.min(n, SEARCH_LIMIT_MAX);
            }),

        cursor: z
            .string()
            .optional()
            .transform((val) => (val?.trim() ? val.trim() : undefined)),
    }),
});

export type GlobalSearchQueryParams = z.infer<typeof globalSearchQuerySchema>['query'];
