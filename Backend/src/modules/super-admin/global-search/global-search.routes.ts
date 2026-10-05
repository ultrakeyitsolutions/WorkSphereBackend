/**
 * SuperAdmin Global Search Routes
 *
 * Base path (mounted in super-admin/index.ts):
 *   /api/superadmin/global-search
 *   /api/super-admin/global-search  (both prefixes are active per routes/index.ts)
 *
 * Security:
 *   requireSuperAdmin ensures:
 *     1. Valid JWT token (authenticate)
 *     2. Authenticating account has SUPER_ADMIN role
 *
 * Validation:
 *   validateRequest(globalSearchQuerySchema) ensures q is present and within
 *   length limits, and normalises limit + cursor before they reach the controller.
 */

import { Router } from 'express';
import { GlobalSearchController } from './global-search.controller';
import { authenticate } from '../../../middleware/auth.middleware';
import { validateRequest } from '../../../middleware/validateRequest';
import { globalSearchQuerySchema } from './global-search.validator';

const router = Router();

// ── Require valid authentication on all search requests ──────────────────────
router.use(authenticate);

/**
 * GET /api/superadmin/global-search
 * GET /api/global-search
 *
 * @query q      {string}  Search term (2-100 chars, required)
 * @query limit  {number}  Max results per page (1-50, default 20)
 * @query cursor {string}  Pagination cursor from previous response
 *
 * @returns {GlobalSearchResult} Grouped, ranked results across companies,
 *                               projects, members/employees, and tasks
 */
router.get(
    '/',
    validateRequest(globalSearchQuerySchema),
    GlobalSearchController.search
);

export default router;
