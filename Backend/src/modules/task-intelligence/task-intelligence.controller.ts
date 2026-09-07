import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { TaskIntelligenceService } from './task-intelligence.service';
import { AppError } from '../../utils/AppError';

export class TaskIntelligenceController {
    
    /**
     * Get task intelligence metrics
     * GET /api/v1/company/task-intelligence/:taskId
     */
    static getTaskIntelligence = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;

        if (!companyId || !userId) {
            throw AppError.unauthorized('Unauthorized');
        }

        if (!taskId) {
            throw AppError.badRequest('taskId is required');
        }

        const intelligence = await TaskIntelligenceService.getTaskIntelligence(companyId, userId, taskId);
        
        sendSuccess(res, 'Task intelligence retrieved successfully.', intelligence, 200);
    });
}
