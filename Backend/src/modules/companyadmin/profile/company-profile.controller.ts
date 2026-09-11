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

export const getCompanyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = getActor(req);
    const profile = await CompanyProfileService.getProfile(companyId);
    return sendSuccess(res, 'Company profile fetched successfully', profile);
});

export const updateCompanyProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId, userId, email, role } = getActor(req);
    const profile = await CompanyProfileService.updateProfile(companyId, req.body, userId, email, role);
    return sendSuccess(res, 'Company profile updated successfully', profile);
});
