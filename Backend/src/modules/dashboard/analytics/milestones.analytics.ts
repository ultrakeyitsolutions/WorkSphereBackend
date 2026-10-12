import { Types } from 'mongoose';
import { Release } from '../../releases/release.model';
import { ReleaseStatus } from '../../releases/release.types';
import { Project } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import { Task } from '../../tasks/task.model';
import {
    CompanyMilestonesData,
    MilestoneCardItem,
} from '../dashboard.types';

export class MilestonesAnalytics {
    public static async getMilestones(
        companyId: Types.ObjectId,
        filterProjectId?: Types.ObjectId,
        statusFilter?: string,
        page = 1,
        limit = 10,
        now = new Date()
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

                milestoneItems.push({
                    id: String(proj._id),
                    name: `${proj.name} Delivery Target`,
                    type: 'PROJECT_END',
                    projectId: String(proj._id),
                    projectName: proj.name,
                    targetDate: targetDate.toISOString(),
                    status: proj.status,
                    progressPercentage,
                    totalTasks: stats.total,
                    completedTasks: stats.completed,
                    daysRemaining,
                    isOverdue,
                });
            }
        }

        // 4. Calculate summaries
        const total = milestoneItems.length;
        const completed = milestoneItems.filter((m) => m.status === 'RELEASED' || m.status === 'Completed').length;
        const overdue = milestoneItems.filter((m) => m.isOverdue).length;
        const upcoming = total - completed - overdue;

        // 5. Paginate
        const totalPages = Math.ceil(total / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedMilestones = milestoneItems.slice(startIndex, startIndex + limit);

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: 'UTC',
            },
            summary: {
                total,
                upcoming: Math.max(0, upcoming),
                completed,
                overdue,
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
