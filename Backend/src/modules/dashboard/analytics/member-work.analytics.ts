import { Types } from 'mongoose';
import { Task } from '../../tasks/task.model';
import { Project, ProjectTeamMember, ProjectInCharge } from '../../companyadmin/projects/project.model';
import { ProjectStatus } from '../../companyadmin/projects/project.types';
import {
    MemberMyWorkData,
    MemberTaskItem,
    MemberProjectSummary,
} from '../dashboard.types';

export class MemberWorkAnalytics {
    public static async getMyWork(
        companyId: Types.ObjectId,
        userId: Types.ObjectId,
        limit = 10,
        now = new Date()
    ): Promise<MemberMyWorkData> {
        const cappedLimit = Math.min(Math.max(limit, 1), 50);
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const taskMatch: any = {
            companyId,
            assignedToId: userId,
            isArchived: { $ne: true },
            isDeleted: { $ne: true },
            completedDate: null,
        };

        const [
            inProgressDocs,
            overdueDocs,
            upcomingDocs,
            inProgressCount,
            overdueCount,
            upcomingCount,
            teamMemberships,
            managedProjects,
            createdProjects,
        ] = await Promise.all([
            // 1. In-progress tasks
            Task.find(taskMatch)
                .sort({ priority: 1, dueDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            // 2. Overdue tasks
            Task.find({
                ...taskMatch,
                dueDate: { $lt: now },
            })
                .sort({ dueDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            // 3. Upcoming tasks (next 7 days)
            Task.find({
                ...taskMatch,
                dueDate: { $gte: now, $lte: sevenDaysLater },
            })
                .sort({ dueDate: 1 })
                .limit(cappedLimit)
                .populate<{ projectId: { _id: Types.ObjectId; name: string } }>('projectId', 'name')
                .lean(),

            // Total counts
            Task.countDocuments(taskMatch),
            Task.countDocuments({ ...taskMatch, dueDate: { $lt: now } }),
            Task.countDocuments({ ...taskMatch, dueDate: { $gte: now, $lte: sevenDaysLater } }),

            // Member projects
            ProjectTeamMember.find({ userId }).select('projectId').lean(),
            ProjectInCharge.find({ userId }).select('projectId').lean(),
            Project.find({ companyId, createdById: userId, deletedAt: null }).select('_id').lean(),
        ]);

        // Transform Member Tasks
        const mapTask = (t: any): MemberTaskItem => ({
            id: String(t._id),
            title: t.title,
            taskNumber: t.taskNumber,
            projectId: String(t.projectId?._id || t.projectId),
            projectName: t.projectId?.name || 'Project',
            priority: t.priority,
            status: t.statusId ? String(t.statusId) : undefined,
            dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
            progress: t.progress || 0,
        });

        const inProgressTasks = inProgressDocs.map(mapTask);
        const overdueTasks = overdueDocs.map(mapTask);
        const upcomingTasks = upcomingDocs.map(mapTask);

        // Resolve Project Details
        const pIdSet = new Set<string>();
        teamMemberships.forEach((m) => pIdSet.add(String(m.projectId)));
        managedProjects.forEach((m) => pIdSet.add(String(m.projectId)));
        createdProjects.forEach((p) => pIdSet.add(String(p._id)));
        const projectIds = Array.from(pIdSet).map((id) => new Types.ObjectId(id));

        let myProjects: MemberProjectSummary[] = [];

        if (projectIds.length > 0) {
            const projectDocs = await Project.find({
                _id: { $in: projectIds },
                companyId,
                deletedAt: null,
                status: { $ne: ProjectStatus.ARCHIVED },
            })
                .sort({ isPinned: -1, createdAt: -1 })
                .limit(cappedLimit)
                .select('_id name status priority')
                .lean();

            const pTargetIds = projectDocs.map((p) => p._id);

            // Aggregate overall and personal task stats on each project
            const [allProjectStats, myProjectStats] = await Promise.all([
                Task.aggregate([
                    {
                        $match: {
                            companyId,
                            projectId: { $in: pTargetIds },
                            isArchived: { $ne: true },
                            isDeleted: { $ne: true },
                        },
                    },
                    {
                        $group: {
                            _id: '$projectId',
                            total: { $sum: 1 },
                            completed: { $sum: { $cond: [{ $gt: ['$completedDate', null] }, 1, 0] } },
                        },
                    },
                ]),
                Task.aggregate([
                    {
                        $match: {
                            companyId,
                            projectId: { $in: pTargetIds },
                            assignedToId: userId,
                            isArchived: { $ne: true },
                            isDeleted: { $ne: true },
                        },
                    },
                    {
                        $group: {
                            _id: '$projectId',
                            total: { $sum: 1 },
                            completed: { $sum: { $cond: [{ $gt: ['$completedDate', null] }, 1, 0] } },
                        },
                    },
                ]),
            ]);

            const allMap = new Map<string, { total: number; completed: number }>();
            allProjectStats.forEach((s) => allMap.set(String(s._id), { total: s.total, completed: s.completed }));

            const myMap = new Map<string, { total: number; completed: number }>();
            myProjectStats.forEach((s) => myMap.set(String(s._id), { total: s.total, completed: s.completed }));

            myProjects = projectDocs.map((p) => {
                const pIdStr = String(p._id);
                const allStats = allMap.get(pIdStr) || { total: 0, completed: 0 };
                const memberStats = myMap.get(pIdStr) || { total: 0, completed: 0 };
                const progressPercentage = allStats.total > 0
                    ? Math.round((allStats.completed / allStats.total) * 10000) / 100
                    : 0;

                return {
                    id: pIdStr,
                    name: p.name,
                    status: p.status,
                    priority: p.priority,
                    totalTasks: allStats.total,
                    completedTasks: allStats.completed,
                    myTasks: memberStats.total,
                    myCompletedTasks: memberStats.completed,
                    progressPercentage,
                };
            });
        }

        return {
            meta: {
                generatedAt: now.toISOString(),
                timezone: 'UTC',
            },
            summary: {
                inProgressCount,
                overdueCount,
                upcomingCount,
                projectsCount: projectIds.length,
            },
            inProgressTasks,
            overdueTasks,
            upcomingTasks,
            myProjects,
        };
    }
}
