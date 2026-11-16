import { Types } from 'mongoose';
import { Release } from '../../releases/release.model';
import { ReleaseStatus } from '../../releases/release.types';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import {
    CompanyMilestonesData,
    MilestoneCardItem,
    FunnelStage,
    ResolvedDateRange,
} from '../dashboard.types';

export class MilestonesAnalytics {
    public static async getMilestones(
        companyId: Types.ObjectId,
        filterProjectId?: Types.ObjectId,
        statusFilter?: string,
        page = 1,
        limit = 10,
        now = new Date(),
        dateRange?: ResolvedDateRange
    ): Promise<CompanyMilestonesData> {
        const releaseMatch: any = { companyId };
        if (filterProjectId) {
            releaseMatch.projectId = filterProjectId;
        }
        if (statusFilter) {
            releaseMatch.status = statusFilter;
        } else {
            releaseMatch.status = { $ne: ReleaseStatus.CANCELLED };
        }
        if (dateRange) {
            releaseMatch.$or = [
                { targetDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                {
                    $and: [
                        { startDate: { $lte: dateRange.endDate } },
                        { targetDate: { $gte: dateRange.startDate } },
                    ],
                },
            ];
        }

        // 1. Fetch releases
        const releases = await Release.find(releaseMatch)
            .sort({ targetDate: 1 })
            .populate<{ projectId: { _id: Types.ObjectId; name: string; status: string; deletedAt: Date | null } }>(
                'projectId',
                'name status deletedAt'
            )
            .lean();

        // Filter out soft-deleted projects
        const validReleases = releases.filter((r) => r.projectId && !r.projectId.deletedAt);

        const milestoneItems: MilestoneCardItem[] = [];

        // 2. Transform releases into MilestoneCardItems
        for (const rel of validReleases) {
            const targetDate = rel.targetDate ? new Date(rel.targetDate) : now;
            const diffMs = targetDate.getTime() - now.getTime();
            const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const isCompleted = rel.status === ReleaseStatus.RELEASED;
            const isOverdue = !isCompleted && targetDate < now;

            const snapshot = rel.taskSnapshot || { totalTasks: 0, completedTasks: 0, completionPercentage: 0 };

            milestoneItems.push({
                id: String(rel._id),
                name: rel.name,
                version: rel.version,
                type: 'RELEASE',
                projectId: String(rel.projectId._id),
                projectName: rel.projectId.name,
                targetDate: targetDate.toISOString(),
                status: rel.status,
                progressPercentage: snapshot.completionPercentage || 0,
                totalTasks: snapshot.totalTasks || 0,
                completedTasks: snapshot.completedTasks || 0,
                daysRemaining,
                isOverdue,
            });
        }

        // 3. Fallback: If no releases exist, include active project target end dates as major milestones
        if (milestoneItems.length === 0) {
            const projectMatch: any = {
                companyId,
                deletedAt: null,
                status: { $in: [ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD] },
            };
            if (filterProjectId) {
                projectMatch._id = filterProjectId;
            }
            if (dateRange) {
                projectMatch.$or = [
                    { endDate: { $gte: dateRange.startDate, $lte: dateRange.endDate } },
                    {
                        $and: [
                            { startDate: { $lte: dateRange.endDate } },
                            { endDate: { $gte: dateRange.startDate } },
                        ],
                    },
                    { endDate: null, createdAt: { $lte: dateRange.endDate } },
                ];
            }

            const activeProjects = await Project.find(projectMatch)
                .sort({ endDate: 1 })
                .limit(20)
                .lean();

            const pIds = activeProjects.map((p) => p._id);
            const taskStats = await Task.aggregate([
                {
                    $match: {
                        companyId,
                        projectId: { $in: pIds },
                        isArchived: { $ne: true },
                        isDeleted: { $ne: true },
                    },
                },
                {
                    $group: {
                        _id: '$projectId',
                        total: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $gt: ['$completedDate', null] }, 1, 0] },
                        },
                    },
                },
            ]);

            const pStatsMap = new Map<string, { total: number; completed: number }>();
            taskStats.forEach((s) => pStatsMap.set(String(s._id), { total: s.total, completed: s.completed }));

            for (const proj of activeProjects) {
                const targetDate = proj.endDate ? new Date(proj.endDate) : now;
                const diffMs = targetDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                const isOverdue = targetDate < now;

                const stats = pStatsMap.get(String(proj._id)) || { total: 0, completed: 0 };
                const progressPercentage = stats.total > 0
                    ? Math.round((stats.completed / stats.total) * 10000) / 100
                    : 0;

                let milestoneStatus: string = 'PLANNED';
                if (proj.status === ProjectStatus.COMPLETED || progressPercentage >= 100) {
                    milestoneStatus = 'RELEASED';
                } else if (progressPercentage >= 80) {
                    milestoneStatus = 'READY_TO_SHIP';
                } else if (progressPercentage > 0 || stats.completed > 0) {
                    milestoneStatus = 'IN_PROGRESS';
                } else {
                    milestoneStatus = 'PLANNED';
                }

                milestoneItems.push({
                    id: String(proj._id),
                    name: `${proj.name} Delivery Target`,
                    type: 'PROJECT_END',
                    projectId: String(proj._id),
                    projectName: proj.name,
                    targetDate: targetDate.toISOString(),
                    status: milestoneStatus,
                    progressPercentage,
                    totalTasks: stats.total,
                    completedTasks: stats.completed,
                    daysRemaining,
                    isOverdue,
                });
            }
        }

        // 4. Calculate summaries & pipeline funnel
        const total = milestoneItems.length;
        const completed = milestoneItems.filter(
            (m) => m.status === 'RELEASED' || m.status === 'Completed' || m.status === 'Released'
        ).length;
        const overdue = milestoneItems.filter((m) => m.isOverdue).length;
        const upcoming = Math.max(0, total - completed - overdue);

        const plannedCount = milestoneItems.filter((m) => m.status === 'PLANNED' || m.status === 'Planned').length;
        const inProgressCount = milestoneItems.filter(
            (m) => m.status === 'IN_PROGRESS' || m.status === 'Active' || m.status === 'In Progress'
        ).length;
        const readyCount = milestoneItems.filter(
            (m) => m.status === 'READY_TO_SHIP' || m.status === 'Ready to Ship'
        ).length;
        const releasedCount = completed;

        const stage1Count = total;
        const stage2Count = inProgressCount + readyCount + releasedCount;
        const stage3Count = readyCount + releasedCount;
        const stage4Count = releasedCount;

        const stages: FunnelStage[] = [
            {
                id: 'planned',
                label: 'Planned',
                count: stage1Count,
                stageCount: plannedCount,
                percentage: total > 0 ? 100 : 0,
                color: '#84cc16',
            },
            {
                id: 'in_progress',
                label: 'In Progress',
                count: stage2Count,
                stageCount: inProgressCount,
                percentage: total > 0 ? Math.round((stage2Count / total) * 100) : 0,
                color: '#3b82f6',
            },
            {
                id: 'ready_to_ship',
                label: 'Ready to Ship',
                count: stage3Count,
                stageCount: readyCount,
                percentage: total > 0 ? Math.round((stage3Count / total) * 100) : 0,
                color: '#a855f7',
            },
            {
                id: 'released',
                label: 'Released',
                count: stage4Count,
                stageCount: releasedCount,
                percentage: total > 0 ? Math.round((stage4Count / total) * 100) : 0,
                color: '#ec4899',
            },
        ];

        // 5. Paginate
        const totalPages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedMilestones = milestoneItems.slice(startIndex, startIndex + limit);

        const completionPercentage = total > 0 ? Math.round((releasedCount / total) * 1000) / 10 : 0;

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: dateRange?.timezone || 'UTC',
                period: dateRange?.period,
            },
            summary: {
                total,
                upcoming,
                completed: releasedCount,
                overdue,
                percentageChange: completionPercentage,
            },
            funnel: {
                totalVolume: total || 0,
                stages,
            },
            milestones: paginatedMilestones,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        };
    }
}
