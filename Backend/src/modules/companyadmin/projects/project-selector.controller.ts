import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { ProjectSelectorService, SelectorQuery } from './project-selector.service';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getCompanyId(req: AuthenticatedRequest): string {
    const companyId = req.user?.companyId;
    if (!companyId) throw AppError.unauthorized('Unauthorized: Missing company context');
    return companyId;
}

function parseSelectorQuery(req: AuthenticatedRequest): SelectorQuery {
    const qs = (key: string): string | undefined => {
        const val = req.query[key];
        return typeof val === 'string' ? val : undefined;
    };
    return {
        page: req.query.page ? parseInt(qs('page') ?? '1', 10) : undefined,
        limit: req.query.limit ? parseInt(qs('limit') ?? '50', 10) : undefined,
        search: qs('search'),
    };
}

// ─── GET /api/v1/company/projects/selectors/employees ────────────────────────

export const getEmployeeSelector = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = getCompanyId(req);
    const result = await ProjectSelectorService.getEmployeeSelector(companyId, parseSelectorQuery(req));
    return sendSuccess(res, 'Employees fetched successfully', result);
});

// ─── GET /api/v1/company/projects/selectors/managers ─────────────────────────

export const getManagerSelector = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = getCompanyId(req);
    const result = await ProjectSelectorService.getManagerSelector(companyId, parseSelectorQuery(req));
    return sendSuccess(res, 'Managers fetched successfully', result);
});

// ─── GET /api/v1/company/projects/selectors/clients ──────────────────────────

export const getClientSelector = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = getCompanyId(req);
    const result = await ProjectSelectorService.getClientSelector(companyId, parseSelectorQuery(req));
    return sendSuccess(res, 'Clients fetched successfully', result);
});

// ─── GET /api/v1/company/projects/selectors/members ──────────────────────────

export const getMemberSelector = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const companyId = getCompanyId(req);
    const result = await ProjectSelectorService.getMemberSelector(companyId, parseSelectorQuery(req));
    return sendSuccess(res, 'Company members fetched successfully', result);
});
