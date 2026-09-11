import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { CompanyProfileService } from './company-profile.service';

function getActor(req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    const email = req.user?.email ?? '';
    const role = req.user?.role ?? '';
    if (!userId || !companyId) throw AppError.unauthorized('Unauthorized: Missing user/company context');
    return { userId, companyId, email, role };
}

// ── GET /api/v1/company/profile ───────────────────────────────────────────────
export const getCompanyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const profile = await CompanyProfileService.getProfile(companyId);
    return sendSuccess(res, 'Company profile fetched successfully', profile);
});

// ── PATCH /api/v1/company/profile ─────────────────────────────────────────────
export const updateCompanyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId, userId, email, role } = getActor(req);
    const profile = await CompanyProfileService.updateProfile(companyId, req.body, userId, email, role);
    return sendSuccess(res, 'Company profile updated successfully', profile);
});

// ── GET /api/v1/company/profile/plans ─────────────────────────────────────────
export const getAvailablePlans = catchAsync(async (_req: AuthenticatedRequest, res: Response) => {
    const plans = await CompanyProfileService.getAvailablePlans();
    return sendSuccess(res, 'Available plans fetched successfully', plans);
});

// ── POST /api/v1/company/profile/upgrade-request ──────────────────────────────
export const createUpgradeRequest = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId, userId, email, role } = getActor(req);
    const result = await CompanyProfileService.createUpgradeRequest(companyId, userId, req.body, email, role);
    return sendSuccess(res, 'Plan upgrade request submitted successfully', result, 201);
});

// ── GET /api/v1/company/profile/upgrade-requests ──────────────────────────────
export const getUpgradeRequests = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const requests = await CompanyProfileService.getUpgradeRequests(companyId);
    return sendSuccess(res, 'Plan upgrade requests fetched successfully', requests);
});
