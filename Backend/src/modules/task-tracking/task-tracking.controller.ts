import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { catchAsync } from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import { TaskTrackingService } from './task-tracking.service';
import { AppError } from '../../utils/AppError';

export class TaskTrackingController {
    
    /**
     * Start tracking a task
     * POST /api/v1/company/task-tracking/start
     * Body: { taskId: string }
     */
    static startTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.body.taskId as string;

        if (!companyId || !userId) {
            throw AppError.unauthorized('Unauthorized');
        }

        if (!taskId) {
            throw AppError.badRequest('taskId is required');
        }

        const tracking = await TaskTrackingService.startTracking(companyId, userId, taskId);
        
        sendSuccess(res, 'Task started successfully.', { tracking }, 200);
    });

    /**
     * Get current active tracking for user
     * GET /api/v1/company/task-tracking/current
     */
    static getCurrentTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;

        if (!companyId || !userId) {
            throw AppError.unauthorized('Unauthorized');
        }

        const tracking = await TaskTrackingService.getCurrentTracking(companyId, userId);
        
        sendSuccess(res, 'Current tracking session retrieved', tracking || null, 200);
    });

    /**
     * Get tracking history for a specific task
     * GET /api/v1/company/task-tracking/task/:taskId
     */
    static getTrackingByTask = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;

        if (!companyId || !userId) {
            throw AppError.unauthorized('Unauthorized');
        }

        const tracking = await TaskTrackingService.getTrackingByTask(companyId, userId, taskId);
        
        sendSuccess(res, 'Task tracking retrieved', tracking || null, 200);
    });
}
