import { Types } from 'mongoose';
import { Release } from './release.model';
import { ReleaseStatus } from './release.types';
import { Project } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { Task } from '../tasks/task.model';
import { AppError } from '../../utils/AppError';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { AuditAction } from '../audit-logs/audit-log.types';
import { NotificationEventBus } from '../notifications/notification.event-bus';

export class ReleaseService {
    /**
     * Create a new Release.
     */
    static async createRelease(
        projectId: string,
        companyId: string,
        userId: string,
        data: {
            name: string;
            version: string;
            description?: string | null;
            startDate?: Date | null;
            targetDate: Date;
            status?: ReleaseStatus;
            releaseNotes?: string | null;
            sprintIds?: string[];
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw AppError.notFound('Project not found');

        // Check for duplicate version in this project
        const existingVersion = await Release.findOne({
            projectId: new Types.ObjectId(projectId),
            version: data.version.trim(),
        }).lean();

        if (existingVersion) {
            throw AppError.conflict(`Release version "${data.version}" already exists in this project`);
        }

        const sprintObjectIds = (data.sprintIds || [])
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id));

        const release = await Release.create({
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            name: data.name,
            version: data.version.trim(),
            description: data.description || null,
            startDate: data.startDate || null,
            targetDate: data.targetDate,
            status: data.status || ReleaseStatus.PLANNED,
            releaseNotes: data.releaseNotes || null,
            sprintIds: sprintObjectIds,
            createdBy: new Types.ObjectId(userId),
        });

        const populated = await Release.findById(release._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .populate('sprintIds', 'name status startDate endDate')
            .lean();

        AuditLogService.log({
            action: AuditAction.RELEASE_CREATED,
            actorId: userId,
            companyId,
            metadata: { projectId, releaseId: String(release._id), name: data.name, version: data.version },
            description: `Release "${data.name}" (${data.version}) was created in project "${project.name}"`,
        });

        return {
            ...populated,
            progress: 0,
            taskStats: { total: 0, completed: 0 },
        };
    }

    /**
     * Get paginated releases with dynamic task progress calculations in a single aggregation batch.
     */
    static async getReleases(
        projectId: string,
        companyId: string,
        userId: string,
        query: {
            page?: number;
            limit?: number;
            search?: string;
            version?: string;
            status?: ReleaseStatus;
            startDate?: string;
            targetDate?: string;
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
        if (query.version) filter.version = { $regex: query.version.trim(), $options: 'i' };

        if (query.startDate || query.targetDate) {
            if (query.startDate) filter.startDate = { $gte: new Date(query.startDate) };
            if (query.targetDate) filter.targetDate = { $lte: new Date(query.targetDate) };
        }

        if (query.search) {
            const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { name: { $regex: escaped, $options: 'i' } },
                { version: { $regex: escaped, $options: 'i' } },
                { description: { $regex: escaped, $options: 'i' } },
                { releaseNotes: { $regex: escaped, $options: 'i' } },
            ];
        }

        const sortField = query.sortBy || 'targetDate';
        const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
        const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

        const [releases, total] = await Promise.all([
            Release.find(filter)
                .populate('createdBy', 'name email avatar')
                .populate('updatedBy', 'name email avatar')
                .populate('sprintIds', 'name status startDate endDate')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            Release.countDocuments(filter),
        ]);

        if (releases.length === 0) {
            return {
                releases: [],
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

        // Batch aggregate task stats for all returned releases in ONE query
        const releaseIds = releases.map((r) => r._id);
        const taskAggregates = await Task.aggregate([
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    releaseId: { $in: releaseIds },
                    isArchived: false,
                },
            },
            {
                $group: {
                    _id: '$releaseId',
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: {
                            $cond: [{ $eq: ['$progress', 100] }, 1, 0],
                        },
                    },
                },
            },
        ]);

        const statsMap = new Map<string, any>();
        for (const stat of taskAggregates) {
            statsMap.set(String(stat._id), stat);
        }

        const enrichedReleases = releases.map((r) => {
            const rId = String(r._id);
            const stat = statsMap.get(rId) || { totalTasks: 0, completedTasks: 0 };
            const progress = stat.totalTasks > 0
                ? Math.round((stat.completedTasks / stat.totalTasks) * 100)
                : 0;

            return {
                ...r,
                progress,
                sprintCount: (r.sprintIds || []).length,
                taskStats: {
                    total: stat.totalTasks,
                    completed: stat.completedTasks,
                },
            };
        });

        return {
            releases: enrichedReleases,
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
     * Get single Release by ID with progress and sprint details.
     */
    static async getReleaseById(projectId: string, releaseId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        })
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .populate('sprintIds', 'name status startDate endDate')
            .lean();

        if (!release) throw AppError.notFound('Release not found');

        const stats = await Task.aggregate([
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    releaseId: new Types.ObjectId(releaseId),
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
            ...release,
            progress,
            sprintCount: (release.sprintIds || []).length,
            taskStats: {
                total: totalTasks,
                completed: completedTasks,
            },
        };
    }

    /**
     * Update release details.
     */
    static async updateRelease(
        projectId: string,
        releaseId: string,
        companyId: string,
        userId: string,
        data: {
            name?: string;
            version?: string;
            description?: string | null;
            startDate?: Date | null;
            targetDate?: Date;
            status?: ReleaseStatus;
            releaseNotes?: string | null;
            sprintIds?: string[];
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!release) throw AppError.notFound('Release not found');

        // Prevent invalid status transitions: RELEASED release cannot return to IN_PROGRESS
        if (release.status === ReleaseStatus.RELEASED && data.status && data.status !== ReleaseStatus.RELEASED) {
            throw AppError.conflict('Already published release cannot be moved back to an unreleased status');
        }

        if (data.version && data.version.trim() !== release.version) {
            const existingVersion = await Release.findOne({
                _id: { $ne: release._id },
                projectId: new Types.ObjectId(projectId),
                version: data.version.trim(),
            }).lean();

            if (existingVersion) {
                throw AppError.conflict(`Release version "${data.version}" already exists in this project`);
            }
            release.version = data.version.trim();
        }

        if (data.name !== undefined) release.name = data.name;
        if (data.description !== undefined) release.description = data.description;
        if (data.startDate !== undefined) release.startDate = data.startDate;
        if (data.targetDate !== undefined) release.targetDate = data.targetDate;
        if (data.status !== undefined) release.status = data.status;
        if (data.releaseNotes !== undefined) release.releaseNotes = data.releaseNotes;
        if (data.sprintIds !== undefined) {
            release.sprintIds = data.sprintIds
                .filter((id) => Types.ObjectId.isValid(id))
                .map((id) => new Types.ObjectId(id));
        }
        release.updatedBy = new Types.ObjectId(userId);

        await release.save();

        const populated = await Release.findById(release._id)
            .populate('createdBy', 'name email avatar')
            .populate('updatedBy', 'name email avatar')
            .populate('sprintIds', 'name status startDate endDate')
            .lean();

        AuditLogService.log({
            action: AuditAction.RELEASE_UPDATED,
            actorId: userId,
            companyId,
            metadata: { projectId, releaseId, status: release.status, version: release.version },
            description: `Release "${release.name}" (${release.version}) was updated`,
        });

        return populated;
    }

    /**
     * Start a release (Transition PLANNED -> IN_PROGRESS).
     */
    static async startRelease(projectId: string, releaseId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!release) throw AppError.notFound('Release not found');

        if (release.status === ReleaseStatus.RELEASED) {
            throw AppError.conflict('Cannot restart a published release');
        }

        release.status = ReleaseStatus.IN_PROGRESS;
        if (!release.startDate) {
            release.startDate = new Date();
        }
        release.updatedBy = new Types.ObjectId(userId);
        await release.save();

        AuditLogService.log({
            action: AuditAction.RELEASE_STARTED,
            actorId: userId,
            companyId,
            metadata: { projectId, releaseId, name: release.name, version: release.version },
            description: `Release "${release.name}" (${release.version}) has started`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'RELEASE_STARTED',
            companyId,
            actorId: userId,
            projectId,
            entityId: releaseId,
            entityType: 'RELEASE',
            metadata: { releaseName: release.name, version: release.version, projectId },
        });

        return release;
    }

    /**
     * Mark a release as delivered (Transition -> RELEASED).
     */
    static async releaseVersion(
        projectId: string,
        releaseId: string,
        companyId: string,
        userId: string,
        data: { releaseNotes?: string | null; releasedAt?: Date } = {}
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!release) throw AppError.notFound('Release not found');

        release.status = ReleaseStatus.RELEASED;
        release.releasedAt = data.releasedAt || new Date();
        if (data.releaseNotes !== undefined) {
            release.releaseNotes = data.releaseNotes;
        }
        release.updatedBy = new Types.ObjectId(userId);
        await release.save();

        AuditLogService.log({
            action: AuditAction.RELEASE_RELEASED,
            actorId: userId,
            companyId,
            metadata: { projectId, releaseId, name: release.name, version: release.version, releasedAt: release.releasedAt },
            description: `Release "${release.name}" (${release.version}) has been deployed/released`,
        });

        NotificationEventBus.getInstance().publish({
            type: 'RELEASE_RELEASED',
            companyId,
            actorId: userId,
            projectId,
            entityId: releaseId,
            entityType: 'RELEASE',
            metadata: { releaseName: release.name, version: release.version, projectId },
        });

        return release;
    }

    /**
     * Delete a release and safely unassign tasks.
     */
    static async deleteRelease(projectId: string, releaseId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOneAndDelete({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        });

        if (!release) throw AppError.notFound('Release not found');

        // Unlink tasks from the deleted release
        await Task.updateMany(
            { projectId: new Types.ObjectId(projectId), releaseId: new Types.ObjectId(releaseId) },
            { $set: { releaseId: null } }
        );

        AuditLogService.log({
            action: AuditAction.RELEASE_DELETED,
            actorId: userId,
            companyId,
            metadata: { projectId, releaseId, name: release.name, version: release.version },
            description: `Release "${release.name}" (${release.version}) was deleted and unassigned from tasks`,
        });

        return { success: true, message: 'Release deleted successfully' };
    }

    /**
     * Get paginated tasks belonging to a release.
     */
    static async getReleaseTasks(
        projectId: string,
        releaseId: string,
        companyId: string,
        userId: string,
        query: {
            page?: number;
            limit?: number;
            statusId?: string;
            stageId?: string;
            priority?: string;
            assignedToId?: string;
            sprintId?: string;
            search?: string;
        }
    ) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        }).lean();

        if (!release) throw AppError.notFound('Release not found');

        const page = Math.max(1, query.page || 1);
        const limit = Math.min(100, Math.max(1, query.limit || 20));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
            releaseId: new Types.ObjectId(releaseId),
            isArchived: false,
        };

        if (query.statusId && Types.ObjectId.isValid(query.statusId)) {
            filter.statusId = new Types.ObjectId(query.statusId);
        }
        if (query.stageId && Types.ObjectId.isValid(query.stageId)) {
            filter.stageId = new Types.ObjectId(query.stageId);
        }
        if (query.priority) {
            filter.priority = query.priority;
        }
        if (query.assignedToId && Types.ObjectId.isValid(query.assignedToId)) {
            filter.assignedToId = new Types.ObjectId(query.assignedToId);
        }
        if (query.sprintId && Types.ObjectId.isValid(query.sprintId)) {
            filter.sprintId = new Types.ObjectId(query.sprintId);
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
     * Aggregation pipeline for Release Dashboard Summary.
     */
    static async getReleaseSummary(projectId: string, releaseId: string, companyId: string, userId: string) {
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw AppError.forbidden('You do not have permission to access this project');

        const release = await Release.findOne({
            _id: releaseId,
            projectId: new Types.ObjectId(projectId),
            companyId: new Types.ObjectId(companyId),
        }).lean();

        if (!release) throw AppError.notFound('Release not found');

        const now = new Date();

        const pipeline: any[] = [
            {
                $match: {
                    projectId: new Types.ObjectId(projectId),
                    companyId: new Types.ObjectId(companyId),
                    releaseId: new Types.ObjectId(releaseId),
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
                    inProgressTasks: {
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
                    todoTasks: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $eq: ['$progress', 0] },
                                        { $eq: ['$progress', null] },
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
                },
            },
        ];

        const results = await Task.aggregate(pipeline);
        const stats = results[0] || {
            totalTasks: 0,
            completedTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            overdueTasks: 0,
        };

        const completionPercentage = stats.totalTasks > 0
            ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
            : 0;

        return {
            totalTasks: stats.totalTasks,
            completedTasks: stats.completedTasks,
            inProgressTasks: stats.inProgressTasks,
            todoTasks: stats.todoTasks,
            overdueTasks: stats.overdueTasks,
            sprintCount: (release.sprintIds || []).length,
            completionPercentage,
        };
    }
}
