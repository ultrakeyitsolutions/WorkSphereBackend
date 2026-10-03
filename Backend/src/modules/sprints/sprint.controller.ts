import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { SprintService } from './sprint.service';
import { sendSuccess } from '../../utils/response';

export class SprintController {
    static async createSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const sprint = await SprintService.createSprint(projectId, companyId, userId, req.body);
            return sendSuccess(res, 'Sprint created successfully', sprint, 201);
        } catch (error) {
            next(error);
        }
    }

    static async getSprints(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const result = await SprintService.getSprints(projectId, companyId, userId, req.query as any);
            return res.status(200).json({
                success: true,
                message: 'Sprints retrieved successfully',
                data: result.sprints,
                pagination: result.pagination,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSprintById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const sprint = await SprintService.getSprintById(projectId, sprintId, companyId, userId);
            return sendSuccess(res, 'Sprint retrieved successfully', sprint);
        } catch (error) {
            next(error);
        }
    }

    static async updateSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const sprint = await SprintService.updateSprint(projectId, sprintId, companyId, userId, req.body);
            return sendSuccess(res, 'Sprint updated successfully', sprint);
        } catch (error) {
            next(error);
        }
    }

    static async startSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const sprint = await SprintService.startSprint(projectId, sprintId, companyId, userId);
            return sendSuccess(res, 'Sprint started successfully', sprint);
        } catch (error) {
            next(error);
        }
    }

    static async completeSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const sprint = await SprintService.completeSprint(projectId, sprintId, companyId, userId);
            return sendSuccess(res, 'Sprint completed successfully', sprint);
        } catch (error) {
            next(error);
        }
    }

    static async deleteSprint(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const result = await SprintService.deleteSprint(projectId, sprintId, companyId, userId);
            return sendSuccess(res, result.message, null);
        } catch (error) {
            next(error);
        }
    }

    static async getSprintTasks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const result = await SprintService.getSprintTasks(projectId, sprintId, companyId, userId, req.query as any);
            return res.status(200).json({
                success: true,
                message: 'Sprint tasks retrieved successfully',
                data: result.tasks,
                pagination: result.pagination,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSprintSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;

            const summary = await SprintService.getSprintSummary(projectId, sprintId, companyId, userId);
            return sendSuccess(res, 'Sprint summary retrieved successfully', summary);
        } catch (error) {
            next(error);
        }
    }

    static async updateSprintTaskStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const sprintId = req.params.sprintId as string;
            const taskId = req.params.taskId as string;

            const updatedTask = await SprintService.updateSprintTaskStatus(
                projectId,
                sprintId,
                taskId,
                companyId,
                userId,
                req.body
            );
            return sendSuccess(res, 'Task status updated successfully', updatedTask);
        } catch (error) {
            next(error);
        }
    }
}
