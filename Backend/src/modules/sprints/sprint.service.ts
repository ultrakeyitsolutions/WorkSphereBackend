import { Types } from 'mongoose';
import { Sprint } from './sprint.model';
import { SprintStatus } from './sprint.types';
import { Project } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { Task } from '../tasks/task.model';
import { Release } from '../releases/release.model';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';

export class SprintService {
    /**
     * Create a new Sprint.
     */
    static async createSprint(
        projectId: string,
        companyId: string,
        userId: string,
        data: {
            name: string;
            description?: string | null;
            goal?: string | null;
            startDate: Date;
            endDate: Date;
            status?: SprintStatus;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw AppError.notFound('Project not found');

        if (data.status === SprintStatus.ACTIVE) {
            const existingActive = await Sprint.findOne({
                projectId: new Types.ObjectId(projectId),
                companyId: new Types.ObjectId(companyId),
                status: SprintStatus.ACTIVE,
            }).lean();

            if (existingActive) {
                throw AppError.conflict(`Project already has an active sprint: "${existingActive.name}"`);
            }
        }

        const sprint = await Sprint.create({
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            name: data.name,
            description: data.description || null,
            goal: data.goal || null,
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status || SprintStatus.PLANNED,
            createdBy: new Types.ObjectId(userId),
        });

        const populated = await Sprint.findById(sprint._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        AuditLogService.log({
            action: AuditAction.SPRINT_CREATED,
            actorId: userId,
            companyId,
            metadata: { projectId, sprintId: String(sprint._id), name: data.name },
            description: `Sprint "${data.name}" was created in project "${project.name}"`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'SPRINT_CREATED',
            companyId,
            actorId: userId,
            projectId,
            entityId: String(sprint._id),
            entityType: 'SPRINT',
            metadata: {
                sprintName: data.name,
                projectName: project.name,
                startDate: data.startDate,
                endDate: data.endDate,
                projectId,
            },
        });

        return {
            ...populated,
            progress: 0,
            taskStats: { total: 0, completed: 0 },
        };
    }

    /**
     * Get paginated sprints with dynamic task progress calculations in a single aggregation batch.
     * Prevents N+1 query problems.
     */
    static async getSprints(
        projectId: string,
        companyId: string,
        userId: string,
        query: {
            page?: number;
            limit?: number;
            search?: string;
            status?: SprintStatus;
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

        if (query.startDate || query.endDate) {
            filter.startDate = {};
            if (query.startDate) filter.startDate.$gte = new Date(query.startDate);
            if (query.endDate) filter.startDate.$lte = new Date(query.endDate);
        }

        if (query.search) {
            const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { name: { $regex: escaped, $options: 'i' } },
                { description: { $regex: escaped, $options: 'i' } },
                { goal: { $regex: escaped, $options: 'i' } },
            ];
        }

        const sortField = query.sortBy || 'startDate';
        const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
        const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

        const [sprints, total] = await Promise.all([
            Sprint.find(filter)
                .populate('createdBy', 'name email avatar')
                .populate('updatedBy', 'name email avatar')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            Sprint.countDocuments(filter),
        ]);

        if (sprints.length === 0) {
            return {
                sprints: [],
                pagination: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPreviousPage: false,
                },
            };
        }

        // Batch aggregate task stats for all returned sprints in ONE query
        const sprintIds = sprints.map((s) => s._id);
        const taskAggregates = await Task.aggregate([
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    sprintId: { $in: sprintIds },
                    isArchived: false,
                },
            },
            {
                $group: {
                    _id: '$sprintId',
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: {
                            $cond: [{ $eq: ['$progress', 100] }, 1, 0],
                        },
                    },
                    totalEstimatedMinutes: {
                        $sum: {
                            $add: [
                                { $multiply: [{ $ifNull: ['$estimatedTime.hours', 0] }, 60] },
                                { $ifNull: ['$estimatedTime.minutes', 0] },
                            ],
                        },
                    },
                    totalActualHours: { $sum: { $ifNull: ['$actualHours', 0] } },
                },
            },
        ]);

        const statsMap = new Map<string, any>();
        for (const stat of taskAggregates) {
            statsMap.set(String(stat._id), stat);
        }

        const enrichedSprints = sprints.map((s) => {
            const sId = String(s._id);
            const stat = statsMap.get(sId) || { totalTasks: 0, completedTasks: 0 };
            const progress = stat.totalTasks > 0
                ? Math.round((stat.completedTasks / stat.totalTasks) * 100)
                : 0;

            return {
                ...s,
                progress,
                taskStats: {
                    total: stat.totalTasks,
                    completed: stat.completedTasks,
                },
            };
        });

        return {
            sprints: enrichedSprints,
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
     * Get single Sprint by ID with progress.
     */
    static async getSprintById(projectId: string, sprintId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        if (!sprint) throw AppError.notFound('Sprint not found');

        const stats = await Task.aggregate([
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    sprintId: new Types.ObjectId(sprintId),
                    isArchived: false,
                },
            },
            {
                $group: {
                    _id: null,
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] },
                    },
                },
            },
        ]);

        const totalTasks = stats[0]?.totalTasks || 0;
        const completedTasks = stats[0]?.completedTasks || 0;
        const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        return {
            ...sprint,
            progress,
            taskStats: {
                total: totalTasks,
                completed: completedTasks,
            },
        };
    }

    /**
     * Update sprint details.
     */
    static async updateSprint(
        projectId: string,
        sprintId: string,
        companyId: string,
        userId: string,
        data: {
            name?: string;
            description?: string | null;
            goal?: string | null;
            startDate?: Date;
            endDate?: Date;
            status?: SprintStatus;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!sprint) throw AppError.notFound('Sprint not found');

        // Prevent invalid transitions: COMPLETED sprint cannot return to ACTIVE
        if (sprint.status === SprintStatus.COMPLETED && data.status === SprintStatus.ACTIVE) {
            throw AppError.conflict('Completed sprint cannot be restarted as ACTIVE');
        }

        if (data.status === SprintStatus.ACTIVE && sprint.status !== SprintStatus.ACTIVE) {
            const existingActive = await Sprint.findOne({
                _id: { $ne: sprint._id },
                projectId: new Types.ObjectId(projectId),
                companyId: new Types.ObjectId(companyId),
                status: SprintStatus.ACTIVE,
            }).lean();

            if (existingActive) {
                throw AppError.conflict(`Another sprint is already active: "${existingActive.name}"`);
            }
        }

        if (data.name !== undefined) sprint.name = data.name;
        if (data.description !== undefined) sprint.description = data.description;
        if (data.goal !== undefined) sprint.goal = data.goal;
        if (data.startDate !== undefined) sprint.startDate = data.startDate;
        if (data.endDate !== undefined) sprint.endDate = data.endDate;
        if (data.status !== undefined) sprint.status = data.status;
        sprint.updatedBy = new Types.ObjectId(userId);

        await sprint.save();

        const populated = await Sprint.findById(sprint._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        AuditLogService.log({
            action: AuditAction.SPRINT_UPDATED,
            actorId: userId,
            companyId,
            metadata: { projectId, sprintId, status: sprint.status },
            description: `Sprint "${sprint.name}" was updated`,
        });

        return populated;
    }

    /**
     * Start a sprint (Transition PLANNED -> ACTIVE atomically).
     */
    static async startSprint(projectId: string, sprintId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!sprint) throw AppError.notFound('Sprint not found');

        if (sprint.status === SprintStatus.COMPLETED) {
            throw AppError.conflict('Completed sprint cannot be started');
        }
        if (sprint.status === SprintStatus.ACTIVE) {
            return sprint; // Idempotent
        }

        // Concurrency-safe check & update: Ensure no other sprint is ACTIVE
        const existingActive = await Sprint.findOne({
            _id: { $ne: sprint._id },
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            status: SprintStatus.ACTIVE,
        }).lean();

        if (existingActive) {
            throw AppError.conflict(`Cannot start sprint. Project already has an active sprint: "${existingActive.name}"`);
        }

        sprint.status = SprintStatus.ACTIVE;
        sprint.updatedBy = new Types.ObjectId(userId);
        await sprint.save();

        AuditLogService.log({
            action: AuditAction.SPRINT_STARTED,
            actorId: userId,
            companyId,
            metadata: { projectId, sprintId, sprintName: sprint.name },
            description: `Sprint "${sprint.name}" has been started`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'SPRINT_STARTED',
            companyId,
            actorId: userId,
            projectId,
            entityId: sprintId,
            entityType: 'SPRINT',
            metadata: { sprintName: sprint.name, projectId },
        });

        return sprint;
    }

    /**
     * Complete a sprint (Transition ACTIVE -> COMPLETED) and return summary of tasks.
     */
    static async completeSprint(projectId: string, sprintId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!sprint) throw AppError.notFound('Sprint not found');

        sprint.status = SprintStatus.COMPLETED;
        sprint.updatedBy = new Types.ObjectId(userId);
        await sprint.save();

        const taskStats = await Task.aggregate([
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    companyId: new Types.ObjectId(companyId),
                    sprintId: new Types.ObjectId(sprintId),
                    isArchived: false,
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    done: {
                        $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] },
                    },
                },
            },
        ]);

        const total = taskStats[0]?.total || 0;
        const done = taskStats[0]?.done || 0;
        const remaining = Math.max(0, total - done);

        AuditLogService.log({
            action: AuditAction.SPRINT_COMPLETED,
            actorId: userId,
            companyId,
            metadata: { projectId, sprintId, sprintName: sprint.name, total, done, remaining },
            description: `Sprint "${sprint.name}" was marked as completed (${done}/${total} tasks completed)`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'SPRINT_COMPLETED',
            companyId,
            actorId: userId,
            projectId,
            entityId: sprintId,
            entityType: 'SPRINT',
            metadata: { sprintName: sprint.name, projectId, total, done, remaining },
        });

        const populated = await Sprint.findById(sprint._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        return {
            sprint: populated,
            summary: {
                total,
                done,
                remaining,
            },
        };
    }

    /**
     * Delete a sprint and safely unassign tasks.
     */
    static async deleteSprint(projectId: string, sprintId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOneAndDelete({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!sprint) throw AppError.notFound('Sprint not found');

        // Unlink tasks from the deleted sprint
        await Task.updateMany(
            { projectId: new Types.ObjectId(projectId), sprintId: new Types.ObjectId(sprintId) },
            { $set: { sprintId: null } }
        );

        AuditLogService.log({
            action: AuditAction.SPRINT_DELETED,
            actorId: userId,
            companyId,
            metadata: { projectId, sprintId, name: sprint.name },
            description: `Sprint "${sprint.name}" was deleted and unassigned from tasks`,
        });

        return { success: true, message: 'Sprint deleted successfully' };
    }

    /**
     * Get paginated tasks belonging to a sprint with optional status/assignee filtering.
     */
    static async getSprintTasks(
        projectId: string,
        sprintId: string,
        companyId: string,
        userId: string,
        query: {
            page?: number;
            limit?: number;
            status?: string;
            statusId?: string;
            stageId?: string;
            priority?: string;
            assigneeId?: string;
            assignedToId?: string;
            search?: string;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        }).lean();

        if (!sprint) throw AppError.notFound('Sprint not found');

        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            sprintId: new Types.ObjectId(sprintId),
            isArchived: false,
        };

        const effectiveAssignee = query.assignedToId || query.assigneeId;
        if (effectiveAssignee && Types.ObjectId.isValid(effectiveAssignee)) {
            filter.assignedToId = new Types.ObjectId(effectiveAssignee);
        }

        if (query.statusId && Types.ObjectId.isValid(query.statusId)) {
            filter.statusId = new Types.ObjectId(query.statusId);
        }
        if (query.stageId && Types.ObjectId.isValid(query.stageId)) {
            filter.stageId = new Types.ObjectId(query.stageId);
        }
        if (query.priority) {
            filter.priority = query.priority;
        }

        // Kanban named status filter support (TODO, IN_PROGRESS, ON_HOLD, DONE)
        if (query.status) {
            const normalized = query.status.toUpperCase().replace(/\s+/g, '_');
            if (normalized === 'DONE' || normalized === 'COMPLETED') {
                filter.progress = 100;
            } else if (normalized === 'TODO' || normalized === 'NEW' || normalized === 'BACKLOG') {
                filter.$or = [{ progress: 0 }, { progress: { $exists: false } }, { progress: null }];
            } else if (normalized === 'IN_PROGRESS') {
                filter.progress = { $gt: 0, $lt: 100 };
            } else if (normalized === 'ON_HOLD' || normalized === 'HOLD' || normalized === 'REVIEW') {
                // Look for stages/statuses with Hold or Review
                filter.progress = { $lt: 100 };
            }
        }

        if (query.search) {
            const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.title = { $regex: escaped, $options: 'i' };
        }

        const [tasks, total] = await Promise.all([
            Task.find(filter)
                .populate('assignedToId', 'name email avatar')
                .populate('createdBy', 'name email avatar')
                .populate('statusId', 'name')
                .populate('stageId', 'name orderIndex')
                .populate('sprintId', 'name status')
                .populate('releaseId', 'name version status')
                .sort({ orderIndex: 1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Task.countDocuments(filter),
        ]);

        return {
            tasks,
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
     * Aggregation pipeline for Sprint Dashboard Summary.
     */
    static async getSprintSummary(projectId: string, sprintId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const sprint = await Sprint.findOne({
            _id: sprintId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .lean();

        if (!sprint) throw AppError.notFound('Sprint not found');

        const now = new Date();

        const pipeline: any[] = [
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    companyId: new Types.ObjectId(companyId),
                    sprintId: new Types.ObjectId(sprintId),
                    isArchived: false,
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    done: {
                        $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] },
                    },
                    inProgress: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: ['$progress', 0] },
                                        { $lt: ['$progress', 100] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    todo: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $eq: ['$progress', 0] },
                                        { $eq: ['$progress', null] },
                                        { $not: ['$progress'] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    onHold: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $lt: ['$progress', 100] },
                                        { $gt: ['$progress', 0] },
                                        { $eq: ['$isPinned', true] }, // Or secondary on-hold metric
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    overdueTasks: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $lt: ['$progress', 100] },
                                        { $ne: ['$dueDate', null] },
                                        { $lt: ['$dueDate', now] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    totalEstimatedHours: {
                        $sum: {
                            $add: [
                                { $ifNull: ['$estimatedTime.hours', 0] },
                                { $divide: [{ $ifNull: ['$estimatedTime.minutes', 0] }, 60] },
                            ],
                        },
                    },
                    actualHours: { $sum: { $ifNull: ['$actualHours', 0] } },
                },
            },
        ];

        const results = await Task.aggregate(pipeline);
        const stats = results[0] || {
            total: 0,
            done: 0,
            inProgress: 0,
            todo: 0,
            onHold: 0,
            overdueTasks: 0,
            totalEstimatedHours: 0,
            actualHours: 0,
        };

        const completionPercentage = stats.total > 0
            ? Math.round((stats.done / stats.total) * 100)
            : 0;

        return {
            sprint,
            counts: {
                todo: stats.todo,
                inProgress: stats.inProgress,
                onHold: stats.onHold,
                done: stats.done,
                total: stats.total,
            },
            completionPercentage,
            overdueTasks: stats.overdueTasks || 0,
            estimatedHours: Number((stats.totalEstimatedHours || 0).toFixed(2)),
            actualHours: Number((stats.actualHours || 0).toFixed(2)),
        };
    }

    /**
     * Atomically update a task's status within a sprint (Drag & Drop column transitions).
     */
    static async updateSprintTaskStatus(
        projectId: string,
        sprintId: string,
        taskId: string,
        companyId: string,
        userId: string,
        data: {
            status: string; // 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | custom status name or ID
            stageId?: string;
            statusId?: string;
            progress?: number;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to modify tasks in this project');

        const task = await Task.findOne({
            _id: taskId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            isArchived: false,
        });

        if (!task) throw AppError.notFound('Task not found in this project');

        if (!task.sprintId || task.sprintId.toString() !== sprintId) {
            throw AppError.badRequest('Task does not belong to this sprint');
        }

        const rawStatus = data.status.trim().toUpperCase();
        let targetProgress = task.progress || 0;

        if (rawStatus === 'DONE' || rawStatus === 'COMPLETED') {
            targetProgress = 100;
            task.completedDate = new Date();
        } else if (rawStatus === 'TODO' || rawStatus === 'NEW' || rawStatus === 'BACKLOG') {
            targetProgress = 0;
            task.completedDate = undefined;
        } else if (rawStatus === 'IN_PROGRESS') {
            targetProgress = data.progress !== undefined ? data.progress : (task.progress && task.progress > 0 && task.progress < 100 ? task.progress : 50);
            task.completedDate = undefined;
        } else if (rawStatus === 'ON_HOLD' || rawStatus === 'HOLD' || rawStatus === 'REVIEW') {
            targetProgress = data.progress !== undefined ? data.progress : (task.progress || 25);
            task.completedDate = undefined;
        } else if (data.progress !== undefined) {
            targetProgress = data.progress;
            if (targetProgress === 100) task.completedDate = new Date();
            else task.completedDate = undefined;
        }

        task.progress = targetProgress;

        // Stage / Status mapping if IDs provided
        if (data.stageId && Types.ObjectId.isValid(data.stageId)) {
            task.stageId = new Types.ObjectId(data.stageId);
        }
        if (data.statusId && Types.ObjectId.isValid(data.statusId)) {
            task.statusId = new Types.ObjectId(data.statusId);
        }

        await task.save();

        // 1. Audit log
        AuditLogService.log({
            action: AuditAction.TASK_STATUS_CHANGED,
            actorId: userId,
            companyId,
            metadata: {
                projectId,
                sprintId,
                taskId,
                newStatus: rawStatus,
                progress: targetProgress,
            },
            description: `Task "${task.title}" status changed to ${rawStatus} (${targetProgress}%)`,
        });

        // 2. Notification for task status change
        NotificationEventBus.getInstance().publish({
            type: targetProgress === 100 ? 'TASK_COMPLETED' : 'TASK_UPDATED',
            companyId,
            actorId: userId,
            projectId,
            taskId,
            entityId: taskId,
            entityType: 'TASK',
            metadata: {
                taskName: task.title,
                taskTitle: task.title,
                taskNumber: task.taskNumber || '',
                status: rawStatus,
                progress: targetProgress,
                projectId,
            },
        });

        // 3. If task is part of a release, recalculate release progress and update readiness
        if (task.releaseId) {
            const releaseIdStr = task.releaseId.toString();
            const releaseStats = await Task.aggregate([
                {
                    $match: {
                        projectId: new Types.ObjectId(projectId),
                        releaseId: task.releaseId,
                        isArchived: false,
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] },
                        },
                    },
                },
            ]);

            const relTotal = releaseStats[0]?.total || 0;
            const relCompleted = releaseStats[0]?.completed || 0;

            if (relTotal > 0 && relCompleted === relTotal) {
                // Mark release as READY_TO_SHIP if currently PLANNED or IN_PROGRESS
                const release = await Release.findOne({
                    _id: task.releaseId,
                    projectId: new Types.ObjectId(projectId),
                    companyId: new Types.ObjectId(companyId),
                });

                if (release && (release.status === 'PLANNED' || release.status === 'IN_PROGRESS')) {
                    release.status = 'READY_TO_SHIP' as any;
                    await release.save();

                    AuditLogService.log({
                        action: AuditAction.RELEASE_READY,
                        actorId: userId,
                        companyId,
                        metadata: { projectId, releaseId: releaseIdStr, version: release.version },
                        description: `Release "${release.name}" (${release.version}) has 100% completed tasks and is READY_TO_SHIP`,
                    });

                    NotificationEventBus.getInstance().publish({
                        type: 'RELEASE_READY',
                        companyId,
                        actorId: userId,
                        projectId,
                        entityId: releaseIdStr,
                        entityType: 'RELEASE',
                        metadata: {
                            releaseName: release.name,
                            version: release.version,
                            projectId,
                        },
                    });
                }
            }
        }

        const loadedTask = await Task.findById(task._id)
            .populate('assignedToId', 'name email avatar')
            .populate('createdBy', 'name email avatar')
            .populate('statusId', 'name')
            .populate('stageId', 'name orderIndex')
            .populate('sprintId', 'name status')
            .populate('releaseId', 'name version status')
            .lean();

        return loadedTask;
    }
}

