import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ReleaseService } from './release.service';
import { sendSuccess } from '../../utils/response';

export class ReleaseController {
    static async createRelease(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const release = await ReleaseService.createRelease(projectId, companyId, userId, req.body);
            return sendSuccess(res, 'Release created successfully', release, 201);
        } catch (error) {
            next(error);
        }
    }

    static async getReleases(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const result = await ReleaseService.getReleases(projectId, companyId, userId, req.query as any);
            return res.status(200).json({
                success: true,
                message: 'Releases retrieved successfully',
                data: result.releases,
                pagination: result.pagination,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getReleaseById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const release = await ReleaseService.getReleaseById(projectId, releaseId, companyId, userId);
            return sendSuccess(res, 'Release retrieved successfully', release);
        } catch (error) {
            next(error);
        }
    }

    static async updateRelease(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const release = await ReleaseService.updateRelease(projectId, releaseId, companyId, userId, req.body);
            return sendSuccess(res, 'Release updated successfully', release);
        } catch (error) {
            next(error);
        }
    }

    static async startRelease(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const release = await ReleaseService.startRelease(projectId, releaseId, companyId, userId);
            return sendSuccess(res, 'Release started successfully', release);
        } catch (error) {
            next(error);
        }
    }

    static async shipRelease(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const release = await ReleaseService.shipRelease(projectId, releaseId, companyId, userId, req.body || {});
            return sendSuccess(res, 'Release shipped successfully', release);
        } catch (error) {
            next(error);
        }
    }

    static async releaseVersion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const release = await ReleaseService.shipRelease(projectId, releaseId, companyId, userId, req.body || {});
            return sendSuccess(res, 'Release deployed/marked as released successfully', release);
        } catch (error) {
            next(error);
        }
    }

    static async deleteRelease(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const result = await ReleaseService.deleteRelease(projectId, releaseId, companyId, userId);
            return sendSuccess(res, result.message, null);
        } catch (error) {
            next(error);
        }
    }

    static async getReleaseTasks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const result = await ReleaseService.getReleaseTasks(projectId, releaseId, companyId, userId, req.query as any);
            return res.status(200).json({
                success: true,
                message: 'Release tasks retrieved successfully',
                data: result.tasks,
                pagination: result.pagination,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getReleaseSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const releaseId = req.params.releaseId as string;

            const summary = await ReleaseService.getReleaseSummary(projectId, releaseId, companyId, userId);
            return sendSuccess(res, 'Release summary retrieved successfully', summary);
        } catch (error) {
            next(error);
        }
    }
}
