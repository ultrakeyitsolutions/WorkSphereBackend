import mongoose, { Types } from 'mongoose';
import { Wishlist } from './wishlist.model';
import { WishlistStatus, WishlistPriority } from './wishlist.types';
import { Project, ProjectSettings } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { Task, TaskPriority, TaskCriticality, TaskType } from '../tasks/task.model';
import { Status } from '../tasks/status.model';
import { Stage } from '../tasks/stage.model';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';

export class WishlistService {
    /**
     * Create a new wishlist item under a verified project.
     */
    static async createWishlist(
        projectId: string,
        companyId: string,
        userId: string,
        data: {
            title: string;
            description?: string | null;
            priority?: WishlistPriority;
            tags?: string[];
            status?: WishlistStatus;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw AppError.notFound('Project not found');

        const item = await Wishlist.create({
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            title: data.title,
            description: data.description || null,
            priority: data.priority || WishlistPriority.MEDIUM,
            status: data.status || WishlistStatus.IDEA,
            tags: data.tags || [],
            createdBy: new Types.ObjectId(userId),
        });

        const populated = await Wishlist.findById(item._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        AuditLogService.log({
            action: AuditAction.WISHLIST_CREATED,
            actorId: userId,
            companyId,
            metadata: { projectId, wishlistId: String(item._id), title: data.title },
            description: `Wishlist item "${data.title}" was created in project "${project.name}"`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'WISHLIST_CREATED',
            companyId,
            actorId: userId,
            projectId,
            entityId: String(item._id),
            entityType: 'WISHLIST',
            metadata: {
                title: data.title,
                projectName: project.name,
                priority: data.priority || WishlistPriority.MEDIUM,
                projectId,
            },
        });

        return populated;
    }

    /**
     * Get paginated wishlist items with robust filtering.
     */
    static async getWishlist(
        projectId: string,
        companyId: string,
        userId: string,
        query: {
            page?: number;
            limit?: number;
            search?: string;
            status?: WishlistStatus;
            priority?: WishlistPriority;
            createdBy?: string;
            startDate?: string;
            endDate?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const project = await Project.findOne({ _id: projectId, companyId }).lean();
        if (!project) throw AppError.notFound('Project not found');

        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        };

        if (query.status) filter.status = query.status;
        if (query.priority) filter.priority = query.priority;
        if (query.createdBy && Types.ObjectId.isValid(query.createdBy)) {
            filter.createdBy = new Types.ObjectId(query.createdBy);
        }

        if (query.startDate || query.endDate) {
            filter.createdAt = {};
            if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
            if (query.endDate) filter.createdAt.$lte = new Date(query.endDate);
        }

        if (query.search) {
            const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { title: { $regex: escaped, $options: 'i' } },
                { description: { $regex: escaped, $options: 'i' } },
                { tags: { $regex: escaped, $options: 'i' } },
            ];
        }

        const sortField = query.sortBy || 'createdAt';
        const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
        const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

        const [items, total] = await Promise.all([
            Wishlist.find(filter)
                .populate('createdBy', 'name email avatar')
                .populate('updatedBy', 'name email avatar')
                .populate('convertedToTaskId', 'title itemNumber taskNumber statusId priority')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            Wishlist.countDocuments(filter),
        ]);

        return {
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            },
        };
    }

    /**
     * Get single wishlist item by ID.
     */
    static async getWishlistById(projectId: string, wishlistId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const item = await Wishlist.findOne({
            _id: wishlistId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .populate('convertedToTaskId', 'title itemNumber taskNumber statusId priority')
            .lean();

        if (!item) throw AppError.notFound('Wishlist item not found');
        return item;
    }

    /**
     * Update wishlist item.
     */
    static async updateWishlist(
        projectId: string,
        wishlistId: string,
        companyId: string,
        userId: string,
        data: {
            title?: string;
            description?: string | null;
            status?: WishlistStatus;
            priority?: WishlistPriority;
            tags?: string[];
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const item = await Wishlist.findOne({
            _id: wishlistId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!item) throw AppError.notFound('Wishlist item not found');

        if (item.status === WishlistStatus.CONVERTED && data.status && data.status !== WishlistStatus.CONVERTED) {
            throw AppError.conflict('Converted wishlist items cannot change status directly');
        }

        const oldStatus = item.status;

        if (data.title !== undefined) item.title = data.title;
        if (data.description !== undefined) item.description = data.description;
        if (data.status !== undefined) item.status = data.status;
        if (data.priority !== undefined) item.priority = data.priority;
        if (data.tags !== undefined) item.tags = data.tags;
        item.updatedBy = new Types.ObjectId(userId);

        await item.save();

        const populated = await Wishlist.findById(item._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .populate('convertedToTaskId', 'title itemNumber taskNumber statusId priority')
            .lean();

        AuditLogService.log({
            action: AuditAction.WISHLIST_UPDATED,
            actorId: userId,
            companyId,
            metadata: { projectId, wishlistId, oldStatus, newStatus: item.status },
            description: `Wishlist item "${item.title}" was updated`,
        });

        if (data.status === WishlistStatus.APPROVED && oldStatus !== WishlistStatus.APPROVED) {
            NotificationEventBus.getInstance().publish({
                type: 'WISHLIST_APPROVED',
                companyId,
                actorId: userId,
                projectId,
                entityId: wishlistId,
                entityType: 'WISHLIST',
                metadata: { title: item.title, itemTitle: item.title, projectId },
            });
        } else if (data.status === WishlistStatus.REJECTED && oldStatus !== WishlistStatus.REJECTED) {
            NotificationEventBus.getInstance().publish({
                type: 'WISHLIST_REJECTED',
                companyId,
                actorId: userId,
                projectId,
                entityId: wishlistId,
                entityType: 'WISHLIST',
                metadata: { title: item.title, itemTitle: item.title, projectId },
            });
        }

        return populated;
    }

    /**
     * Delete wishlist item.
     */
    static async deleteWishlist(projectId: string, wishlistId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const item = await Wishlist.findOneAndDelete({
            _id: wishlistId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!item) throw AppError.notFound('Wishlist item not found');

        AuditLogService.log({
            action: AuditAction.WISHLIST_DELETED,
            actorId: userId,
            companyId,
            metadata: { projectId, wishlistId, title: item.title },
            description: `Wishlist item "${item.title}" was deleted`,
        });

        return { success: true, message: 'Wishlist item deleted successfully' };
    }

    /**
     * Convert Wishlist item into an actionable Task via an ACID Transaction.
     */
    static async convertToTask(
        projectId: string,
        wishlistId: string,
        companyId: string,
        userId: string,
        taskOverrides: any = {}
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw AppError.notFound('Project not found');

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // 1. Lock / atomically retrieve wishlist item inside transaction
            const wishlistItem = await Wishlist.findOne({
                _id: wishlistId,
                projectId: new Types.ObjectId(projectId),
                companyId: new Types.ObjectId(companyId),
            }).session(session);

            if (!wishlistItem) {
                throw AppError.notFound('Wishlist item not found');
            }

            if (wishlistItem.convertedToTaskId || wishlistItem.status === WishlistStatus.CONVERTED) {
                throw AppError.conflict('Wishlist item has already been converted to a task');
            }

            // 2. Fetch or compute default stage and status if not provided
            let statusId = taskOverrides.statusId;
            if (!statusId) {
                const defaultStatus = await Status.findOne({ companyId, isDefault: true }).session(session).lean()
                    || await Status.findOne({ companyId }).session(session).lean();
                statusId = defaultStatus?._id;
            }

            let stageId = taskOverrides.stageId;
            if (!stageId) {
                const defaultStage = await Stage.findOne({ companyId, isDefault: true }).session(session).lean()
                    || await Stage.findOne({ companyId }).session(session).lean();
                stageId = defaultStage?._id;
            }

            // 3. Atomically increment task item number from ProjectSettings
            const settings = await ProjectSettings.findOneAndUpdate(
                { projectId: new Types.ObjectId(projectId) },
                { $inc: { lastTaskItemNumber: 1 } },
                { new: true, upsert: true, session }
            );

            const itemNumber = settings.lastTaskItemNumber;
            const taskNumber = `TASK-${itemNumber}`;

            // Map priority from wishlist to task priority
            const mappedPriority: TaskPriority = taskOverrides.priority
                || (wishlistItem.priority === WishlistPriority.URGENT ? TaskPriority.URGENT
                    : wishlistItem.priority === WishlistPriority.HIGH ? TaskPriority.HIGH
                    : wishlistItem.priority === WishlistPriority.LOW ? TaskPriority.LOW
                    : TaskPriority.MEDIUM);

            // 4. Create Task document
            const createdTasks = await Task.create(
                [
                    {
                        companyId: new Types.ObjectId(companyId),
                        projectId: new Types.ObjectId(projectId),
                        moduleId: taskOverrides.moduleId ? new Types.ObjectId(taskOverrides.moduleId) : undefined,
                        sprintId: taskOverrides.sprintId ? new Types.ObjectId(taskOverrides.sprintId) : null,
                        releaseId: taskOverrides.releaseId ? new Types.ObjectId(taskOverrides.releaseId) : null,
                        title: taskOverrides.title || wishlistItem.title,
                        itemNumber,
                        taskNumber,
                        statusId: statusId ? new Types.ObjectId(statusId) : undefined,
                        stageId: stageId ? new Types.ObjectId(stageId) : undefined,
                        priority: mappedPriority,
                        taskType: taskOverrides.taskType || TaskType.TASK,
                        criticality: taskOverrides.criticality || TaskCriticality.NON_CRITICAL,
                        startDate: taskOverrides.startDate ? new Date(taskOverrides.startDate) : undefined,
                        dueDate: taskOverrides.dueDate ? new Date(taskOverrides.dueDate) : undefined,
                        deliveryDate: taskOverrides.deliveryDate ? new Date(taskOverrides.deliveryDate) : undefined,
                        estimatedTime: taskOverrides.estimatedTime || { hours: 0, minutes: 0 },
                        assignedToId: taskOverrides.assignedToId ? new Types.ObjectId(taskOverrides.assignedToId) : undefined,
                        createdBy: new Types.ObjectId(userId),
                        tags: taskOverrides.tags || wishlistItem.tags || [],
                        notes: (taskOverrides.description || wishlistItem.description)
                            ? [{ content: taskOverrides.description || wishlistItem.description }]
                            : [],
                    },
                ],
                { session }
            );

            const newTask = createdTasks[0];

            // 5. Update Wishlist state atomically
            wishlistItem.convertedToTaskId = newTask._id;
            wishlistItem.status = WishlistStatus.CONVERTED;
            wishlistItem.updatedBy = new Types.ObjectId(userId);
            await wishlistItem.save({ session });

            // Commit the transaction
            await session.commitTransaction();

            // 6. Post-transaction audit & notification dispatch
            AuditLogService.log({
                action: AuditAction.WISHLIST_CONVERTED_TO_TASK,
                actorId: userId,
                companyId,
                metadata: {
                    projectId,
                    wishlistId,
                    taskId: String(newTask._id),
                    taskNumber,
                },
                description: `Wishlist item "${wishlistItem.title}" converted to task ${taskNumber}`,
            });

            NotificationEventBus.getInstance().publish({
                type: 'WISHLIST_CONVERTED_TO_TASK',
                companyId,
                actorId: userId,
                projectId,
                taskId: String(newTask._id),
                entityId: wishlistId,
                entityType: 'WISHLIST',
                metadata: {
                    itemTitle: wishlistItem.title,
                    taskName: newTask.title,
                    taskNumber,
                    projectId,
                },
            });

            return {
                wishlist: wishlistItem,
                task: newTask,
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Aggregation pipeline for high-performance dashboard summary.
     */
    static async getWishlistSummary(projectId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const pipeline: any[] = [
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    companyId: new Types.ObjectId(companyId),
                },
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ];

        const results = await Wishlist.aggregate(pipeline);

        const summary = {
            total: 0,
            ideas: 0,
            underReview: 0,
            approved: 0,
            rejected: 0,
            converted: 0,
        };

        for (const item of results) {
            summary.total += item.count;
            if (item._id === WishlistStatus.IDEA) summary.ideas = item.count;
            else if (item._id === WishlistStatus.UNDER_REVIEW) summary.underReview = item.count;
            else if (item._id === WishlistStatus.APPROVED) summary.approved = item.count;
            else if (item._id === WishlistStatus.REJECTED) summary.rejected = item.count;
            else if (item._id === WishlistStatus.CONVERTED) summary.converted = item.count;
        }

        return summary;
    }
}
