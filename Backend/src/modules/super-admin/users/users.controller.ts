import { Request, Response } from 'express';
import { SuperAdminUsersService } from './users.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class SuperAdminUsersController {
    public static async listUsers(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                companyId: req.query.companyId as string,
                role: req.query.role as string,
                status: req.query.status as string,
            };

            const result = await SuperAdminUsersService.listUsers(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Users retrieved successfully',
                data: {
                    users: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to list users', statusCode);
        }
    }

    public static async getUserDetails(req: Request, res: Response): Promise<Response> {
        try {
            const userId = String(req.params.userId);
            const user = await SuperAdminUsersService.getUserDetails(userId);
            return sendSuccess(res, 'User details retrieved successfully', user);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get user details', statusCode);
        }
    }

    public static async getUserStatistics(req: Request, res: Response): Promise<Response> {
        try {
            const userId = String(req.params.userId);
            const stats = await SuperAdminUsersService.getUserStatistics(userId);
            return sendSuccess(res, 'User statistics retrieved successfully', stats);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get user statistics', statusCode);
        }
    }

    public static async getUserActivity(req: Request, res: Response): Promise<Response> {
        try {
            const userId = String(req.params.userId);
            const pagination = getPaginationParams(req);
            const result = await SuperAdminUsersService.getUserActivity(userId, pagination);
            return res.status(200).json({
                success: true,
                message: 'User activity retrieved successfully',
                data: {
                    activity: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get user activity', statusCode);
        }
    }

    public static async getUserPermissions(req: Request, res: Response): Promise<Response> {
        try {
            const userId = String(req.params.userId);
            const permissions = await SuperAdminUsersService.getUserPermissions(userId);
            return sendSuccess(res, 'User permissions retrieved successfully', permissions);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get user permissions', statusCode);
        }
    }
}
