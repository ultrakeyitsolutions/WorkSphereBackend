import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { WishlistService } from './wishlist.service';
import { sendSuccess } from '../../utils/response';

export class WishlistController {
    static async createWishlist(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const item = await WishlistService.createWishlist(projectId, companyId, userId, req.body);
            return sendSuccess(res, 'Wishlist item created successfully', item, 201);
        } catch (error) {
            next(error);
        }
    }

    static async getWishlist(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const result = await WishlistService.getWishlist(projectId, companyId, userId, req.query as any);
            return res.status(200).json({
                success: true,
                message: 'Wishlist items retrieved successfully',
                data: result.items,
                pagination: result.pagination,
            });
        } catch (error) {
            next(error);
        }
    }

    static async getWishlistById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const wishlistId = req.params.wishlistId as string;

            const item = await WishlistService.getWishlistById(projectId, wishlistId, companyId, userId);
            return sendSuccess(res, 'Wishlist item retrieved successfully', item);
        } catch (error) {
            next(error);
        }
    }

    static async updateWishlist(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const wishlistId = req.params.wishlistId as string;

            const item = await WishlistService.updateWishlist(projectId, wishlistId, companyId, userId, req.body);
            return sendSuccess(res, 'Wishlist item updated successfully', item);
        } catch (error) {
            next(error);
        }
    }

    static async deleteWishlist(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const wishlistId = req.params.wishlistId as string;

            const result = await WishlistService.deleteWishlist(projectId, wishlistId, companyId, userId);
            return sendSuccess(res, result.message, null);
        } catch (error) {
            next(error);
        }
    }

    static async convertToTask(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;
            const wishlistId = req.params.wishlistId as string;

            const result = await WishlistService.convertToTask(projectId, wishlistId, companyId, userId, req.body || {});
            return sendSuccess(res, 'Wishlist item converted to task successfully', result, 201);
        } catch (error) {
            next(error);
        }
    }

    static async getWishlistSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const companyId = req.user?.companyId as string;
            const userId = req.user?.userId as string;
            const projectId = req.params.projectId as string;

            const summary = await WishlistService.getWishlistSummary(projectId, companyId, userId);
            return sendSuccess(res, 'Wishlist summary retrieved successfully', summary);
        } catch (error) {
            next(error);
        }
    }
}
