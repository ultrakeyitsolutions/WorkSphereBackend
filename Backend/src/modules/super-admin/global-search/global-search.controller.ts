/**
 * SuperAdmin Global Search Controller
 *
 * Handles:
 *   GET /api/superadmin/global-search?q=kiran&limit=20&cursor=...
 *
 * Responsibilities:
 *  1. Validate query parameters via Zod (via validateRequest middleware).
 *  2. Delegate business logic to GlobalSearchService.
 *  3. Return structured response using the project's sendSuccess/sendError helpers.
 *  4. Never expose internal errors or sensitive data.
 */

import { Request, Response } from 'express';
import { GlobalSearchService } from './global-search.service';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class GlobalSearchController {
    /**
     * GET /api/superadmin/global-search
     *
     * Query parameters (validated by globalSearchQuerySchema middleware):
     *   q      {string}  Search term (2-100 chars)
     *   limit  {number}  Results per group (1-50, default 20)
     *   cursor {string}  Opaque pagination token from previous response
     */
    public static async search(req: Request, res: Response): Promise<Response> {
        try {
            // req.query is already validated + transformed by validateRequest middleware
            const { q, limit, cursor } = req.query as unknown as {
                q: string;
                limit: number;
                cursor?: string;
            };

            const userContext =
                (req as any).currentUser ||
                (req as any).authenticatedUser ||
                (req as any).user;

            const result = await GlobalSearchService.search(
                q,
                limit as unknown as number,
                cursor,
                userContext
            );

            return sendSuccess(res, 'Global search completed', {
                query: result.query,
                groups: result.groups,
                hasMore: result.hasMore,
                nextCursor: result.nextCursor,
                // Only expose timing metadata in non-production environments
                ...(process.env.NODE_ENV !== 'production' && { meta: result.meta }),
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            const message =
                error instanceof AppError ? error.message : 'Global search failed';

            // Do not leak internal error details in production
            const devErrors =
                process.env.NODE_ENV !== 'production'
                    ? { stack: error?.stack }
                    : undefined;

            return sendError(res, message, statusCode, devErrors);
        }
    }
}
