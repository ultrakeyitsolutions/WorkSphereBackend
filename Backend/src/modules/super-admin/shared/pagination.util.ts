import { Request } from 'express';

export interface PaginationParams {
    page: number;
    limit: number;
    skip: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface PaginatedResult<T> {
    items: T[];
    pagination: PaginationMeta;
}

/**
 * Parses and sanitizes pagination query parameters from Express request.
 */
export function getPaginationParams(
    req: Request,
    defaultLimit = 20,
    maxLimit = 100,
    defaultSortBy = 'createdAt',
    defaultSortOrder: 'asc' | 'desc' = 'desc'
): PaginationParams {
    const rawPage = parseInt(req.query.page as string, 10);
    const rawLimit = parseInt(req.query.limit as string, 10);

    const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;
    let limit = !isNaN(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
    if (limit > maxLimit) {
        limit = maxLimit;
    }

    const skip = (page - 1) * limit;
    const sortBy = (req.query.sortBy as string) || (req.query.sort as string) || defaultSortBy;
    const rawOrder = ((req.query.sortOrder as string) || (req.query.order as string) || '').toLowerCase();
    const sortOrder: 'asc' | 'desc' = rawOrder === 'asc' ? 'asc' : defaultSortOrder;

    return {
        page,
        limit,
        skip,
        sortBy,
        sortOrder,
    };
}

/**
 * Builds standard pagination metadata object.
 */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / (limit || 1)) || 0,
    };
}
