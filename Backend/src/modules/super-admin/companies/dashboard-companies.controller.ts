import { Request, Response } from 'express';
import { DashboardCompaniesService } from './dashboard-companies.service';
import { getPaginationParams } from '../shared/pagination.util';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';

export class DashboardCompaniesController {
    public static async listCompanies(req: Request, res: Response): Promise<Response> {
        try {
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                status: req.query.status as string,
                subscription: req.query.subscription as string,
            };

            const result = await DashboardCompaniesService.listCompanies(pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Companies retrieved successfully',
                data: {
                    companies: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to list companies', statusCode);
        }
    }

    public static async getCompanyDetails(req: Request, res: Response): Promise<Response> {
        try {
            const companyId = String(req.params.companyId);
            const company = await DashboardCompaniesService.getCompanyDetails(companyId);
            return sendSuccess(res, 'Company details retrieved successfully', company);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get company details', statusCode);
        }
    }

    public static async getCompanyStatistics(req: Request, res: Response): Promise<Response> {
        try {
            const companyId = String(req.params.companyId);
            const stats = await DashboardCompaniesService.getCompanyStatistics(companyId);
            return sendSuccess(res, 'Company statistics retrieved successfully', stats);
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get company statistics', statusCode);
        }
    }

    public static async getCompanyUsers(req: Request, res: Response): Promise<Response> {
        try {
            const companyId = String(req.params.companyId);
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                role: req.query.role as string,
                status: req.query.status as string,
            };

            const result = await DashboardCompaniesService.getCompanyUsers(companyId, pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Company users retrieved successfully',
                data: {
                    users: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get company users', statusCode);
        }
    }

    public static async getCompanyProjects(req: Request, res: Response): Promise<Response> {
        try {
            const companyId = String(req.params.companyId);
            const pagination = getPaginationParams(req);
            const filters = {
                search: req.query.search as string,
                status: req.query.status as string,
            };

            const result = await DashboardCompaniesService.getCompanyProjects(companyId, pagination, filters);
            return res.status(200).json({
                success: true,
                message: 'Company projects retrieved successfully',
                data: {
                    projects: result.items,
                    pagination: result.pagination,
                },
            });
        } catch (error: any) {
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            return sendError(res, error.message || 'Failed to get company projects', statusCode);
        }
    }
}
