import { Types } from 'mongoose';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { ProjectHealthService } from '../services/project-health.service';
import {
    CompanyProjectHealthData,
    ProjectHealthCardItem,
    ProjectHealthStatus,
} from '../dashboard.types';

export class ProjectHealthAnalytics {
    public static async getHealth(
        companyId: Types.ObjectId,
        statusFilter?: ProjectHealthStatus,
        page = 1,
        limit = 20,
        filterProjectId?: Types.ObjectId,
        now = new Date()
    ): Promise<CompanyProjectHealthData> {
        // 1. Fetch non-deleted, non-archived projects
        const projectMatch: any = {
            companyId,
            deletedAt: null,
            status: { $nin: [ProjectStatus.ARCHIVED, ProjectStatus.CANCELLED] },
        };

        if (filterProjectId) {
            projectMatch._id = filterProjectId;
        }

        const projects = await Project.find(projectMatch)
            .sort({ isPinned: -1, createdAt: -1 })
            .lean();

        if (projects.length === 0) {
            return {
                meta: {
                    generatedAt: now.toISOString(),
                    timezone: 'UTC',
                    projectId: filterProjectId ? filterProjectId.toString() : undefined,
                },
                summary: {
                    totalEvaluated: 0,
                    onTrack: { count: 0, percentage: 0 },
                    atRisk: { count: 0, percentage: 0 },
                    delayed: { count: 0, percentage: 0 },
                },
                projects: [],
                pagination: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0,
                },
            };
        }

        const projectIds = projects.map((p) => p._id);

        // 2. Aggregate tasks per project
        const taskStats = await Task.aggregate([
            {
                $match: {
                    companyId,
                    projectId: { $in: projectIds },
                    isArchived: { $ne: true },
                    isDeleted: { $ne: true },
                },
            },
            {
                $lookup: {
                    from: 'statuses',
                    localField: 'statusId',
                    foreignField: '_id',
                    as: 'statusDoc',
                },
            },
            {
                $unwind: {
                    path: '$statusDoc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $group: {
                    _id: '$projectId',
                    total: { $sum: 1 },
                    completed: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $gt: ['$completedDate', null] },
                                        {
                                            $regexMatch: {
                                                input: { $ifNull: ['$statusDoc.name', ''] },
                                                regex: /completed|done|closed/i,
                                            },
                                        },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    overdue: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: [{ $ifNull: ['$completedDate', null] }, null] },
                                        { $ne: [{ $ifNull: ['$dueDate', null] }, null] },
                                        { $lt: ['$dueDate', now] },
                                        {
                                            $not: {
                                                $regexMatch: {
                                                    input: { $ifNull: ['$statusDoc.name', ''] },
                                                    regex: /completed|done|closed|cancelled/i,
                                                },
                                            },
                                        },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]);

        const statsMap = new Map<string, { total: number; completed: number; overdue: number }>();
        taskStats.forEach((s) =>
            statsMap.set(String(s._id), {
                total: s.total,
                completed: s.completed,
                overdue: s.overdue,
            })
        );

        // 3. Evaluate health for each project
        const evaluatedProjects: ProjectHealthCardItem[] = projects.map((proj) => {
            const pIdStr = String(proj._id);
            const stats = statsMap.get(pIdStr) || { total: 0, completed: 0, overdue: 0 };
            const progressPercentage = stats.total > 0
                ? Math.round((stats.completed / stats.total) * 10000) / 100
                : 0;

            const health = ProjectHealthService.evaluate(
                {
                    projectId: pIdStr,
                    projectName: proj.name,
                    endDate: proj.endDate,
                    totalTasks: stats.total,
                    completedTasks: stats.completed,
                    overdueTasks: stats.overdue,
                    progressPercentage,
                },
                now
            );

            return {
                projectId: pIdStr,
                projectName: proj.name,
                status: proj.status,
                healthStatus: health.status,
                progressPercentage,
                totalTasks: stats.total,
                completedTasks: stats.completed,
                overdueTasks: stats.overdue,
                startDate: proj.startDate ? new Date(proj.startDate).toISOString() : new Date().toISOString(),
                endDate: proj.endDate ? new Date(proj.endDate).toISOString() : new Date().toISOString(),
                reasons: health.reasons,
            };
        });

        // 4. Compute overall company health distribution
        const totalEvaluated = evaluatedProjects.length;
        const onTrackCount = evaluatedProjects.filter((p) => p.healthStatus === 'on_track').length;
        const atRiskCount = evaluatedProjects.filter((p) => p.healthStatus === 'at_risk').length;
        const delayedCount = evaluatedProjects.filter((p) => p.healthStatus === 'delayed').length;

        const onTrackPercentage = totalEvaluated > 0
            ? Math.round((onTrackCount / totalEvaluated) * 10000) / 100
            : 0;
        const atRiskPercentage = totalEvaluated > 0
            ? Math.round((atRiskCount / totalEvaluated) * 10000) / 100
            : 0;
        const delayedPercentage = totalEvaluated > 0
            ? Math.round((delayedCount / totalEvaluated) * 10000) / 100
            : 0;

        // 5. Apply status filter if requested
        const filtered = statusFilter
            ? evaluatedProjects.filter((p) => p.healthStatus === statusFilter)
            : evaluatedProjects;

        // 6. Paginate results
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedProjects = filtered.slice(startIndex, startIndex + limit);

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: 'UTC',
                projectId: filterProjectId ? filterProjectId.toString() : undefined,
            },
            summary: {
                totalEvaluated,
                onTrack: { count: onTrackCount, percentage: onTrackPercentage },
                atRisk: { count: atRiskCount, percentage: atRiskPercentage },
                delayed: { count: delayedCount, percentage: delayedPercentage },
            },
            projects: paginatedProjects,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        };
    }
}
