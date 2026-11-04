import { Types } from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { ManagerAccessScope, TeamAccessService } from './team-access.service';
import { Project, ProjectTeamMember, ProjectInCharge, ProjectSettings } from '../../companyadmin/projects/project.model';
import { Task } from '../../tasks/task.model';
import { TaskActivity } from '../../task-activities/task-activity.model';
import { User } from '../../users/user.model';

export class ManagerProjectService {
    /**
     * Get accessible projects for manager
     */
    public static async getProjects(
        scope: ManagerAccessScope,
        query: { page?: number; limit?: number; status?: string; search?: string }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: any = {
            companyId: scope.companyId,
            _id: { $in: scope.allAccessibleProjectIds },
            deletedAt: null,
        };

        if (query.status && query.status.toUpperCase() !== 'ALL') {
            filter.status = query.status.toUpperCase();
        }

        if (query.search && query.search.trim()) {
            filter.name = new RegExp(query.search.trim(), 'i');
        }

        const [projects, total] = await Promise.all([
            Project.find(filter)
                .populate('createdById', 'name email avatar')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Project.countDocuments(filter),
        ]);

        return {
            projects: projects.map((p: any) => ({
                id: p._id,
                name: p.name,
                description: p.description,
                type: p.type,
                priority: p.priority,
                status: p.status,
                startDate: p.startDate,
                endDate: p.endDate,
                actualEndDate: p.actualEndDate,
                createdBy: p.createdById ? { id: p.createdById._id, name: p.createdById.name } : null,
                createdAt: p.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get specific project details
     */
    public static async getProjectDetails(scope: ManagerAccessScope, projectIdStr: string) {
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), projectIdStr);

        const [project, settings, inCharges, membersCount, taskStats] = await Promise.all([
            Project.findOne({ _id: projectIdStr, companyId: scope.companyId, deletedAt: null })
                .populate('createdById', 'name email avatar')
                .lean(),
            ProjectSettings.findOne({ projectId: projectIdStr }).lean(),
            ProjectInCharge.find({ projectId: projectIdStr })
                .populate('userId', 'name email avatar')
                .lean(),
            ProjectTeamMember.countDocuments({ projectId: projectIdStr }),
            Task.aggregate([
                { $match: { projectId: new Types.ObjectId(projectIdStr) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ['$progress', 100] }, 1, 0] } },
                    },
                },
            ]),
        ]);

        if (!project) throw AppError.notFound('Project not found');

        const totalTasks = taskStats[0]?.total || 0;
        const completedTasks = taskStats[0]?.completed || 0;

        return {
            project: {
                id: project._id,
                name: project.name,
                description: project.description,
                type: project.type,
                priority: project.priority,
                status: project.status,
                startDate: project.startDate,
                endDate: project.endDate,
                actualEndDate: project.actualEndDate,
                createdBy: project.createdById,
                createdAt: (project as any).createdAt,
            },
            settings: settings || null,
            inCharges: inCharges.map((ic: any) => ic.userId).filter(Boolean),
            metrics: {
                membersCount,
                totalTasks,
                completedTasks,
                progressPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
            },
        };
    }

    /**
     * Get project members
     */
    public static async getProjectMembers(scope: ManagerAccessScope, projectIdStr: string) {
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), projectIdStr);

        const members = await ProjectTeamMember.find({ projectId: projectIdStr })
            .populate('userId', 'name email avatar phoneNumber status lastLoginAt')
            .lean();

        return members.map((m: any) => ({
            id: m._id,
            user: m.userId ? {
                id: m.userId._id,
                name: m.userId.name,
                email: m.userId.email,
                avatar: m.userId.avatar,
                status: m.userId.status,
            } : null,
            canCreateTasks: m.canCreateTasks,
            addedAt: m.addedAt,
        }));
    }

    /**
     * Get project tasks
     */
    public static async getProjectTasks(
        scope: ManagerAccessScope,
        projectIdStr: string,
        query: { statusId?: string; priority?: string; page?: number; limit?: number }
    ) {
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), projectIdStr);

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const filter: any = { companyId: scope.companyId, projectId: projectIdStr };
        if (query.statusId && Types.ObjectId.isValid(query.statusId)) filter.statusId = query.statusId;
        if (query.priority) filter.priority = query.priority;

        const [tasks, total] = await Promise.all([
            Task.find(filter)
                .populate('assignedToId', 'name email avatar')
                .populate('statusId', 'name isCompleted')
                .populate('stageId', 'name')
                .sort({ dueDate: 1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Task.countDocuments(filter),
        ]);

        return {
            tasks: tasks.map((t: any) => ({
                id: t._id,
                title: t.title,
                itemNumber: t.itemNumber,
                taskNumber: t.taskNumber,
                assignedTo: t.assignedToId ? { id: t.assignedToId._id, name: t.assignedToId.name, avatar: t.assignedToId.avatar } : null,
                status: t.statusId ? { id: t.statusId._id, name: t.statusId.name } : null,
                stage: t.stageId ? { id: t.stageId._id, name: t.stageId.name } : null,
                priority: t.priority,
                progress: t.progress,
                dueDate: t.dueDate,
                deliveryDate: t.deliveryDate,
                createdAt: t.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get project report
     */
    public static async getProjectReport(scope: ManagerAccessScope, projectIdStr: string) {
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), projectIdStr);

        const project = await Project.findOne({ _id: projectIdStr, companyId: scope.companyId }).lean();
        if (!project) throw AppError.notFound('Project not found');

        const tasks = await Task.find({ projectId: projectIdStr })
            .populate('assignedToId', 'name')
            .populate('statusId', 'isCompleted')
            .lean();

        const totalTasks = tasks.length;
        let completed = 0;
        let overdue = 0;
        const now = new Date();

        const memberTaskCount = new Map<string, { name: string; count: number; completed: number }>();

        for (const t of tasks as any[]) {
            const isDone = t.progress === 100 || t.statusId?.isCompleted === true;
            if (isDone) completed++;
            else if (t.dueDate && new Date(t.dueDate) < now) overdue++;

            if (t.assignedToId) {
                const uId = String(t.assignedToId._id || t.assignedToId);
                const name = t.assignedToId.name || 'Unknown';
                const cur = memberTaskCount.get(uId) || { name, count: 0, completed: 0 };
                cur.count++;
                if (isDone) cur.completed++;
                memberTaskCount.set(uId, cur);
            }
        }

        return {
            projectId: project._id,
            projectName: project.name,
            status: project.status,
            timeline: { startDate: project.startDate, endDate: project.endDate, actualEndDate: project.actualEndDate },
            totalTasks,
            completedTasks: completed,
            pendingTasks: totalTasks - completed,
            overdueTasks: overdue,
            completionPercentage: totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0,
            memberDistribution: Array.from(memberTaskCount.entries()).map(([userId, data]) => ({
                userId,
                name: data.name,
                tasksAssigned: data.count,
                tasksCompleted: data.completed,
            })),
        };
    }

    /**
     * Get project activity
     */
    public static async getProjectActivity(scope: ManagerAccessScope, projectIdStr: string, limit = 25) {
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), projectIdStr);

        const activities = await TaskActivity.find({ projectId: projectIdStr })
            .populate('userId', 'name email avatar')
            .populate('taskId', 'title taskNumber')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return activities.map((a: any) => ({
            id: a._id,
            type: a.type,
            content: a.content,
            user: a.userId ? { id: a.userId._id, name: a.userId.name, avatar: a.userId.avatar } : null,
            task: a.taskId ? { id: a.taskId._id, title: a.taskId.title, number: a.taskId.taskNumber } : null,
            createdAt: a.createdAt,
        }));
    }
}
export default ManagerProjectService;
