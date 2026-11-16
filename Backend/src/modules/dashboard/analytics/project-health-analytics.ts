import { Types } from 'mongoose';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import { ProjectHealthService } from '../services/project-health.service';
import {
    CompanyProjectHealthData,
    ProjectHealthCardItem,
    ProjectHealthStatus,
    ProjectCategoryHealthSummary,
    ProjectStatusDistributionItem,
    PipelineStageItem,
    ResolvedDateRange,
} from '../dashboard.types';

export class ProjectHealthAnalytics {
    public static async getHealth(
        companyId: Types.ObjectId,
        statusFilter?: ProjectHealthStatus,
        page = 1,
        limit = 20,
        filterProjectId?: Types.ObjectId,
        now = new Date(),
        dateRange?: ResolvedDateRange
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

        if (dateRange) {
            projectMatch.$or = [
                {
                    startDate: { $lte: dateRange.endDate },
                    endDate: { $gte: dateRange.startDate },
                },
                {
                    createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                },
            ];
        }

        const projects = await Project.find(projectMatch)
            .sort({ isPinned: -1, createdAt: -1 })
            .lean();

        if (projects.length === 0) {
            return {
                meta: {
                    generatedAt: now.toISOString(),
                    timezone: dateRange ? dateRange.timezone : 'UTC',
                    projectId: filterProjectId ? filterProjectId.toString() : undefined,
                    dateRange: dateRange ? {
                        period: dateRange.period,
                        startDate: dateRange.startDate.toISOString(),
                        endDate: dateRange.endDate.toISOString(),
                    } : undefined,
                },
                summary: {
                    totalEvaluated: 0,
                    onTrack: { count: 0, percentage: 0 },
                    atRisk: { count: 0, percentage: 0 },
                    delayed: { count: 0, percentage: 0 },
                },
                pipeline: {
                    totalProjects: 0,
                    stages: [
                        { id: 'planning', label: 'Planning', count: 0, percentage: 0, color: '#84cc16' },
                        { id: 'not_started', label: 'Not Started', count: 0, percentage: 0, color: '#94a3b8' },
                        { id: 'in_progress', label: 'In Progress', count: 0, percentage: 0, color: '#3b82f6' },
                        { id: 'under_review', label: 'Under Review', count: 0, percentage: 0, color: '#a855f7' },
                        { id: 'completed', label: 'Completed', count: 0, percentage: 0, color: '#10b981' },
                        { id: 'delayed', label: 'Delayed', count: 0, percentage: 0, color: '#f43f5e' },
                    ],
                },
                categories: [],
                statusDistribution: [],
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

        // 2. Aggregate tasks per project (using 'status' collection)
        const taskMatch: any = {
            companyId,
            projectId: { $in: projectIds },
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
        };

        const taskStats = await Task.aggregate([
            {
                $match: taskMatch,
            },
            {
                $lookup: {
                    from: 'status',
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
                    inReview: {
                        $sum: {
                            $cond: [
                                {
                                    $regexMatch: {
                                        input: { $ifNull: ['$statusDoc.name', ''] },
                                        regex: /review|verify|approval/i,
                                    },
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
                                                    regex: /completed|done|closed|cancelled|reject/i,
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

        const statsMap = new Map<string, { total: number; completed: number; overdue: number; inReview: number }>();
        taskStats.forEach((s) =>
            statsMap.set(String(s._id), {
                total: s.total,
                completed: s.completed,
                overdue: s.overdue,
                inReview: s.inReview,
            })
        );

        // 3. Evaluate health for each project
        const evaluatedProjects: ProjectHealthCardItem[] = projects.map((proj) => {
            const pIdStr = String(proj._id);
            const stats = statsMap.get(pIdStr) || { total: 0, completed: 0, overdue: 0, inReview: 0 };
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
                category: (proj as any).category || (proj as any).type || 'Other',
                type: proj.type,
                priority: proj.priority,
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

        // 4. Map projects into the 6 Delivery Pipeline Stages
        let planningCount = 0;
        let notStartedCount = 0;
        let inProgressCount = 0;
        let underReviewCount = 0;
        let completedCount = 0;
        let delayedCount = 0;

        evaluatedProjects.forEach((proj) => {
            const stats = statsMap.get(proj.projectId) || { total: 0, completed: 0, overdue: 0, inReview: 0 };
            const isCompleted = proj.status === ProjectStatus.COMPLETED || proj.progressPercentage >= 100;
            const isDelayed = proj.healthStatus === 'delayed' || (new Date(proj.endDate) < now && !isCompleted);

            if (isCompleted) {
                completedCount++;
            } else if (isDelayed) {
                delayedCount++;
            } else if (proj.status === ProjectStatus.ON_HOLD || new Date(proj.startDate) > now) {
                planningCount++;
            } else if (stats.inReview > 0 || (proj.progressPercentage >= 85 && proj.progressPercentage < 100)) {
                underReviewCount++;
            } else if (proj.progressPercentage > 0 || stats.completed > 0) {
                inProgressCount++;
            } else {
                notStartedCount++;
            }
        });

        const totalPipeline = evaluatedProjects.length;
        const pipelineStages: PipelineStageItem[] = [
            {
                id: 'planning',
                label: 'Planning',
                count: planningCount,
                percentage: totalPipeline > 0 ? Math.round((planningCount / totalPipeline) * 100) : 0,
                color: '#84cc16',
            },
            {
                id: 'not_started',
                label: 'Not Started',
                count: notStartedCount,
                percentage: totalPipeline > 0 ? Math.round((notStartedCount / totalPipeline) * 100) : 0,
                color: '#94a3b8',
            },
            {
                id: 'in_progress',
                label: 'In Progress',
                count: inProgressCount,
                percentage: totalPipeline > 0 ? Math.round((inProgressCount / totalPipeline) * 100) : 0,
                color: '#3b82f6',
            },
            {
                id: 'under_review',
                label: 'Under Review',
                count: underReviewCount,
                percentage: totalPipeline > 0 ? Math.round((underReviewCount / totalPipeline) * 100) : 0,
                color: '#a855f7',
            },
            {
                id: 'completed',
                label: 'Completed',
                count: completedCount,
                percentage: totalPipeline > 0 ? Math.round((completedCount / totalPipeline) * 100) : 0,
                color: '#10b981',
            },
            {
                id: 'delayed',
                label: 'Delayed',
                count: delayedCount,
                percentage: totalPipeline > 0 ? Math.round((delayedCount / totalPipeline) * 100) : 0,
                color: '#f43f5e',
            },
        ];

        // 5. Group projects by Category
        const categoryMap = new Map<string, {
            categoryId: string;
            categoryName: string;
            totalProjects: number;
            completedProjects: number;
            activeProjects: number;
            inProgressProjects: number;
            pendingProjects: number;
            onHoldProjects: number;
            overdueProjects: number;
        }>();

        evaluatedProjects.forEach((proj) => {
            const rawCat = proj.category || proj.type || 'Other';
            const catName = typeof rawCat === 'string' && rawCat.trim() ? rawCat.trim() : 'Other';
            const catId = `cat-${catName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

            let cat = categoryMap.get(catId);
            if (!cat) {
                cat = {
                    categoryId: catId,
                    categoryName: catName,
                    totalProjects: 0,
                    completedProjects: 0,
                    activeProjects: 0,
                    inProgressProjects: 0,
                    pendingProjects: 0,
                    onHoldProjects: 0,
                    overdueProjects: 0,
                };
                categoryMap.set(catId, cat);
            }

            cat.totalProjects += 1;
            const isCompleted = proj.status === 'Completed' || proj.progressPercentage === 100;
            if (isCompleted) {
                cat.completedProjects += 1;
            } else if (proj.status === 'OnHold') {
                cat.onHoldProjects += 1;
            } else {
                cat.activeProjects += 1;
                if (proj.completedTasks > 0) {
                    cat.inProgressProjects += 1;
                } else {
                    cat.pendingProjects += 1;
                }
            }

            if (proj.overdueTasks > 0 || (new Date(proj.endDate) < now && !isCompleted)) {
                cat.overdueProjects += 1;
            }
        });

        const categories: ProjectCategoryHealthSummary[] = Array.from(categoryMap.values()).map((c) => ({
            ...c,
            completionPercentage: c.totalProjects > 0
                ? Math.round((c.completedProjects / c.totalProjects) * 10000) / 100
                : 0,
        }));

        // 6. Compute overall company health distribution
        const totalEvaluated = evaluatedProjects.length;
        const onTrackCount = evaluatedProjects.filter((p) => p.healthStatus === 'on_track').length;
        const atRiskCount = evaluatedProjects.filter((p) => p.healthStatus === 'at_risk').length;
        const evaluatedDelayedCount = evaluatedProjects.filter((p) => p.healthStatus === 'delayed').length;
        const completedProjectsCount = evaluatedProjects.filter((p) => p.status === 'Completed' || p.progressPercentage === 100).length;
        const activeProjectsCount = Math.max(0, totalEvaluated - completedProjectsCount);

        const onTrackPercentage = totalEvaluated > 0
            ? Math.round((onTrackCount / totalEvaluated) * 10000) / 100
            : 0;
        const atRiskPercentage = totalEvaluated > 0
            ? Math.round((atRiskCount / totalEvaluated) * 10000) / 100
            : 0;
        const delayedPercentage = totalEvaluated > 0
            ? Math.round((evaluatedDelayedCount / totalEvaluated) * 10000) / 100
            : 0;

        const statusDistribution: ProjectStatusDistributionItem[] = [
            {
                statusId: 'on_track',
                statusName: 'On Track',
                count: onTrackCount,
                percentage: totalEvaluated > 0 ? Math.round((onTrackCount / totalEvaluated) * 10000) / 100 : 0,
                healthStatus: 'on_track',
            },
            {
                statusId: 'active',
                statusName: 'In Progress',
                count: activeProjectsCount,
                percentage: totalEvaluated > 0 ? Math.round((activeProjectsCount / totalEvaluated) * 10000) / 100 : 0,
            },
            {
                statusId: 'completed',
                statusName: 'Completed',
                count: completedProjectsCount,
                percentage: totalEvaluated > 0 ? Math.round((completedProjectsCount / totalEvaluated) * 10000) / 100 : 0,
            },
            {
                statusId: 'at_risk',
                statusName: 'At Risk',
                count: atRiskCount,
                percentage: totalEvaluated > 0 ? Math.round((atRiskCount / totalEvaluated) * 10000) / 100 : 0,
                healthStatus: 'at_risk',
            },
            {
                statusId: 'delayed',
                statusName: 'Delayed',
                count: evaluatedDelayedCount,
                percentage: totalEvaluated > 0 ? Math.round((evaluatedDelayedCount / totalEvaluated) * 10000) / 100 : 0,
                healthStatus: 'delayed',
            },
        ];

        // 7. Apply status filter if requested
        const filtered = statusFilter
            ? evaluatedProjects.filter((p) => p.healthStatus === statusFilter)
            : evaluatedProjects;

        // 8. Paginate results
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedProjects = filtered.slice(startIndex, startIndex + limit);

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: dateRange ? dateRange.timezone : 'UTC',
                projectId: filterProjectId ? filterProjectId.toString() : undefined,
                dateRange: dateRange ? {
                    period: dateRange.period,
                    startDate: dateRange.startDate.toISOString(),
                    endDate: dateRange.endDate.toISOString(),
                } : undefined,
            },
            summary: {
                totalEvaluated,
                onTrack: { count: onTrackCount, percentage: onTrackPercentage },
                atRisk: { count: atRiskCount, percentage: atRiskPercentage },
                delayed: { count: evaluatedDelayedCount, percentage: delayedPercentage },
            },
            pipeline: {
                totalProjects: totalPipeline,
                stages: pipelineStages,
            },
            categories,
            statusDistribution,
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
