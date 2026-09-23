import { Types } from 'mongoose';
import {
    Project,
    ProjectInCharge,
    ProjectTeamMember,
} from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { TaskBug, BugStatus } from '../../task-bugs/task-bug.model';
import { TimeTracking } from '../../task-tracking/time-tracking.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../shared/pagination.util';
import { ProjectStatisticsData } from './projects.types';
import { AppError } from '../../../utils/AppError';

export class SuperAdminProjectsService {
    /**
     * List all platform projects across all companies.
     */
    public static async listProjects(
        pagination: PaginationParams,
        filters: { search?: string; companyId?: string; status?: string; ownerId?: string }
    ): Promise<PaginatedResult<any>> {
        const query: any = { deletedAt: null };

        if (filters.status) {
            query.status = filters.status.toUpperCase();
        }

        if (filters.companyId && Types.ObjectId.isValid(filters.companyId)) {
            query.companyId = new Types.ObjectId(filters.companyId);
        }

        if (filters.ownerId && Types.ObjectId.isValid(filters.ownerId)) {
            query.createdById = new Types.ObjectId(filters.ownerId);
        }

        if (filters.search) {
            const regex = new RegExp(filters.search.trim(), 'i');
            query.name = regex;
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [projects, total] = await Promise.all([
            Project.find(query)
                .populate('companyId', 'name slug domain')
                .populate('createdById', 'name email')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            Project.countDocuments(query),
        ]);

        const projectIds = projects.map((p) => p._id);

        const [taskCounts, memberCounts] = await Promise.all([
            Task.aggregate([
                { $match: { projectId: { $in: projectIds } } },
                {
                    $group: {
                        _id: '$projectId',
                        total: { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] } },
                    },
                },
            ]),
            ProjectTeamMember.aggregate([
                { $match: { projectId: { $in: projectIds } } },
                { $group: { _id: '$projectId', count: { $sum: 1 } } },
            ]),
        ]);

        const taskCountMap = new Map<string, { total: number; completed: number }>();
        taskCounts.forEach((t: any) => taskCountMap.set(String(t._id), { total: t.total, completed: t.completed }));

        const memberCountMap = new Map<string, number>();
        memberCounts.forEach((m: any) => memberCountMap.set(String(m._id), m.count));

        const items = projects.map((p: any) => {
            const tInfo = taskCountMap.get(String(p._id)) || { total: 0, completed: 0 };
            const progress = tInfo.total > 0 ? Math.round((tInfo.completed / tInfo.total) * 100) : 0;

            return {
                id: p._id,
                name: p.name,
                description: p.description,
                type: p.type,
                priority: p.priority,
                status: p.status,
                company: p.companyId
                    ? {
                          id: p.companyId._id,
                          name: p.companyId.name,
                          slug: p.companyId.slug,
                      }
                    : null,
                owner: p.createdById
                    ? {
                          id: p.createdById._id,
                          name: p.createdById.name,
                          email: p.createdById.email,
                      }
                    : null,
                startDate: p.startDate,
                endDate: p.endDate,
                progress,
                taskCount: tInfo.total,
                memberCount: memberCountMap.get(String(p._id)) || 0,
                isArchived: p.isArchived,
                isPinned: p.isPinned,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
            };
        });

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Get single project details.
     */
    public static async getProjectDetails(projectId: string) {
        if (!Types.ObjectId.isValid(projectId)) {
            throw AppError.badRequest('Invalid project ID');
        }

        const project: any = await Project.findOne({ _id: projectId, deletedAt: null })
            .populate('companyId', 'name slug domain')
            .populate('createdById', 'name email')
            .lean();

        if (!project) {
            throw AppError.notFound('Project not found');
        }

        const pId = new Types.ObjectId(projectId);

        const [inCharges, members, taskCounts] = await Promise.all([
            ProjectInCharge.find({ projectId: pId })
                .populate('userId', 'name email')
                .lean(),
            ProjectTeamMember.find({ projectId: pId })
                .populate('userId', 'name email')
                .lean(),
            Task.aggregate([
                { $match: { projectId: pId } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] } },
                    },
                },
            ]),
        ]);

        const tInfo = taskCounts.length > 0 ? taskCounts[0] : { total: 0, completed: 0 };
        const progress = tInfo.total > 0 ? Math.round((tInfo.completed / tInfo.total) * 100) : 0;

        return {
            id: project._id,
            name: project.name,
            description: project.description,
            type: project.type,
            priority: project.priority,
            status: project.status,
            company: project.companyId
                ? {
                      id: (project.companyId as any)._id,
                      name: (project.companyId as any).name,
                      slug: (project.companyId as any).slug,
                      domain: (project.companyId as any).domain,
                  }
                : null,
            owner: project.createdById
                ? {
                      id: (project.createdById as any)._id,
                      name: (project.createdById as any).name,
                      email: (project.createdById as any).email,
                  }
                : null,
            inCharges: inCharges.map((ic: any) => ({
                id: ic.userId?._id,
                name: ic.userId?.name,
                email: ic.userId?.email,
                addedAt: ic.addedAt,
            })),
            members: members.map((m: any) => ({
                id: m.userId?._id,
                name: m.userId?.name,
                email: m.userId?.email,
                canCreateTasks: m.canCreateTasks,
                addedAt: m.addedAt,
            })),
            progress,
            taskCount: tInfo.total,
            completedTaskCount: tInfo.completed,
            startDate: project.startDate,
            endDate: project.endDate,
            actualEndDate: project.actualEndDate,
            isArchived: project.isArchived,
            isPinned: project.isPinned,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
        };
    }

    /**
     * Get project statistics.
     */
    public static async getProjectStatistics(projectId: string): Promise<ProjectStatisticsData> {
        if (!Types.ObjectId.isValid(projectId)) {
            throw AppError.badRequest('Invalid project ID');
        }

        const project = await Project.findOne({ _id: projectId, deletedAt: null });
        if (!project) {
            throw AppError.notFound('Project not found');
        }

        const pId = new Types.ObjectId(projectId);

        const [
            totalTasks,
            completedTasks,
            inProgressTasks,
            notStartedTasks,
            totalBugs,
            openBugs,
            resolvedBugs,
            totalMembers,
            inChargeCount,
            timeTrackingAgg,
        ] = await Promise.all([
            Task.countDocuments({ projectId: pId }),
            Task.countDocuments({ projectId: pId, progress: 100 }),
            Task.countDocuments({ projectId: pId, progress: { $gt: 0, $lt: 100 } }),
            Task.countDocuments({ projectId: pId, $or: [{ progress: 0 }, { progress: { $exists: false } }] }),
            TaskBug.countDocuments({ projectId: pId }),
            TaskBug.countDocuments({ projectId: pId, status: { $ne: BugStatus.CLOSED } }),
            TaskBug.countDocuments({ projectId: pId, status: BugStatus.CLOSED }),
            ProjectTeamMember.countDocuments({ projectId: pId }),
            ProjectInCharge.countDocuments({ projectId: pId }),
            TimeTracking.aggregate([
                { $match: { projectId: pId } },
                { $group: { _id: null, totalSeconds: { $sum: '$workedSeconds' } } },
            ]),
        ]);

        const totalWorkedHours = timeTrackingAgg.length > 0
            ? Math.round((timeTrackingAgg[0].totalSeconds / 3600) * 10) / 10
            : 0;

        return {
            projectId,
            tasks: {
                total: totalTasks,
                completed: completedTasks,
                inProgress: inProgressTasks,
                notStarted: notStartedTasks,
            },
            bugs: {
                total: totalBugs,
                open: openBugs,
                resolved: resolvedBugs,
            },
            team: {
                totalMembers,
                inChargeCount,
            },
            timeTracking: {
                totalWorkedHours,
            },
        };
    }
}
