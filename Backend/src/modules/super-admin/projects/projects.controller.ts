import { Request, Response } from 'express';
import { SuperAdminProjectsService } from './projects.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class SuperAdminProjectsController {
    public static async listProjects(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                companyId: req.query.companyId as string,
                status: req.query.status as string,
                ownerId: req.query.ownerId as string,
            };

            const result = await SuperAdminProjectsService.listProjects(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Projects retrieved successfully',
                data: {
                    projects: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to list projects', statusCode);
        }
    }

    public static async getProjectDetails(req: Request, res: Response): Promise<Response> {
        try {
            const projectId = String(req.params.projectId);
            const project = await SuperAdminProjectsService.getProjectDetails(projectId);
            return sendSuccess(res, 'Project details retrieved successfully', project);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get project details', statusCode);
        }
    }

    public static async getProjectStatistics(req: Request, res: Response): Promise<Response> {
        try {
            const projectId = String(req.params.projectId);
            const stats = await SuperAdminProjectsService.getProjectStatistics(projectId);
            return sendSuccess(res, 'Project statistics retrieved successfully', stats);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get project statistics', statusCode);
        }
    }
}
