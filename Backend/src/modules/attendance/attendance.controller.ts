import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { AttendanceService } from './attendance.service';

export class AttendanceController {
    
    static checkIn = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const attendance = await AttendanceService.checkIn(companyId, userId);
        sendSuccess(res, 'Checked in successfully.', { attendance }, 200);
    });

    static checkOut = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const attendance = await AttendanceService.checkOut(companyId, userId);
        sendSuccess(res, 'Checked out successfully.', { attendance }, 200);
    });

    static getCurrentStatus = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');

        const attendance = await AttendanceService.getCurrentStatus(companyId, userId);
        sendSuccess(res, 'Current attendance status retrieved.', attendance || null, 200);
    });
}
