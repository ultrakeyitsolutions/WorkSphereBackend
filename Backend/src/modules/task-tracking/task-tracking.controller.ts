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

    /**
     * Pause tracking a task
     * POST /api/v1/company/task-tracking/pause
     * Body: { taskId: string }
     */
    static pauseTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.body.taskId as string;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId) throw AppError.badRequest('taskId is required');

        const tracking = await TaskTrackingService.pauseTracking(companyId, userId, taskId);
        sendSuccess(res, 'Task paused successfully.', { tracking }, 200);
    });

    /**
     * Put task tracking on hold
     * POST /api/v1/company/task-tracking/hold
     * Body: { taskId: string, reason: string }
     */
    static holdTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const { taskId, reason } = req.body;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId) throw AppError.badRequest('taskId is required');
        if (!reason) throw AppError.badRequest('reason is required');

        const tracking = await TaskTrackingService.holdTracking(companyId, userId, taskId as string, reason as string);
        sendSuccess(res, 'Task placed on hold.', { tracking }, 200);
    });

    /**
     * Resume tracking a paused/held task
     * POST /api/v1/company/task-tracking/resume
     * Body: { taskId: string }
     */
    static resumeTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.body.taskId as string;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId) throw AppError.badRequest('taskId is required');

        const tracking = await TaskTrackingService.resumeTracking(companyId, userId, taskId);
        sendSuccess(res, 'Task resumed successfully.', { tracking }, 200);
    });

    /**
     * Complete task tracking
     * POST /api/v1/company/task-tracking/complete
     * Body: { taskId: string }
     */
    static completeTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.body.taskId as string;

        if (!companyId || !userId) throw AppError.unauthorized('Unauthorized');
        if (!taskId) throw AppError.badRequest('taskId is required');

        const tracking = await TaskTrackingService.completeTracking(companyId, userId, taskId);
        sendSuccess(res, 'Task completed successfully.', { tracking }, 200);
    });

    /**
     * Admin hold — put a member's task on hold on their behalf
     * POST /api/v1/company/task-tracking/admin-hold
     * Body: { taskId: string, targetUserId: string, reason: string }
     * Auth: Caller must be Admin role, ProjectInCharge, or project owner
     */
    static adminHoldTracking = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const adminId = req.user?.userId;   // the company admin / manager making the request
        const { taskId, targetUserId, reason } = req.body;

        if (!companyId || !adminId) throw AppError.unauthorized('Unauthorized');
        if (!taskId) throw AppError.badRequest('taskId is required');
        if (!reason) throw AppError.badRequest('reason is required');

        const tracking = await TaskTrackingService.adminHoldTracking(
            companyId,
            adminId,
            taskId as string,
            targetUserId as string | undefined,
            reason as string
        );

        sendSuccess(res, 'Task placed on hold by admin.', { tracking }, 200);
    });
}
