import { Router } from 'express';
import { WishlistController } from './wishlist.controller';
import { validateRequest } from '../../middleware/validateRequest';
import {
    createWishlistSchema,
    updateWishlistSchema,
    listWishlistSchema,
    wishlistParamSchema,
    convertWishlistToTaskSchema,
} from './wishlist.validator';

const router = Router({ mergeParams: true });

// GET /api/projects/:projectId/wishlist/summary
router.get('/summary', validateRequest(wishlistParamSchema), WishlistController.getWishlistSummary);

// POST /api/projects/:projectId/wishlist
router.post('/', validateRequest(createWishlistSchema), WishlistController.createWishlist);

// GET /api/projects/:projectId/wishlist
router.get('/', validateRequest(listWishlistSchema), WishlistController.getWishlist);

// GET /api/projects/:projectId/wishlist/:wishlistId
router.get('/:wishlistId', validateRequest(wishlistParamSchema), WishlistController.getWishlistById);

// PATCH /api/projects/:projectId/wishlist/:wishlistId
router.patch('/:wishlistId', validateRequest(updateWishlistSchema), WishlistController.updateWishlist);

// DELETE /api/projects/:projectId/wishlist/:wishlistId
router.delete('/:wishlistId', validateRequest(wishlistParamSchema), WishlistController.deleteWishlist);

// POST /api/projects/:projectId/wishlist/:wishlistId/convert-to-task
router.post(
    '/:wishlistId/convert-to-task',
    validateRequest(convertWishlistToTaskSchema),
    WishlistController.convertToTask
);

export default router;
