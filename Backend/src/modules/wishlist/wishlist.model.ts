import { Schema, model } from 'mongoose';
import { IWishlist, WishlistPriority, WishlistStatus } from './wishlist.types';

const wishlistSchema = new Schema<IWishlist>(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 5000,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(WishlistStatus),
            default: WishlistStatus.IDEA,
            required: true,
            index: true,
        },
        priority: {
            type: String,
            enum: Object.values(WishlistPriority),
            default: WishlistPriority.MEDIUM,
            required: true,
            index: true,
        },
        tags: [
            {
                type: String,
                trim: true,
            },
        ],
        convertedToTaskId: {
            type: Schema.Types.ObjectId,
            ref: 'Task',
            default: null,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

// Compound indexes for optimal query efficiency and project isolation
wishlistSchema.index({ projectId: 1, status: 1, createdAt: -1 });
wishlistSchema.index({ companyId: 1, projectId: 1, createdAt: -1 });
wishlistSchema.index({ projectId: 1, priority: 1 });

export const Wishlist = model<IWishlist>('Wishlist', wishlistSchema);
export default Wishlist;
