import { Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { Permission } from './permission.model';
import { AuthenticatedRequest } from '../auth/auth.types';

export const getAllPermissions = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const userRole = req.user?.role as any; // Cast because role could be populated object or ObjectId depending on auth middleware
    
    const filter: any = {};
    
    // If the user is a COMPANY_ADMIN, only return permissions they are allowed to assign
    if (userRole?.name === 'COMPANY_ADMIN') {
        filter.scope = 'COMPANY_MEMBER';
        filter.assignableBy = 'COMPANY_ADMIN';
    }

    const permissions = await Permission.find(filter).sort({ category: 1, name: 1 });
    return sendSuccess(res, 'Permissions fetched successfully', permissions);
});
