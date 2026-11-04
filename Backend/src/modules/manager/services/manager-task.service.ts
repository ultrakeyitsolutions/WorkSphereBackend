import { Types } from 'mongoose';
import { AppError } from '../../../utils/AppError';
import { ManagerAccessScope, TeamAccessService } from './team-access.service';
import { Task } from '../../tasks/task.model';
import { TaskAssignment } from '../../tasks/task-assignment.model';
import { TaskActivity, ActivityType } from '../../task-activities/task-activity.model';
import { Project } from '../../companyadmin/projects/project.model';
import { User } from '../../users/user.model';
import { TaskService } from '../../tasks/task.service';
import { NotificationEventBus } from '../../notifications/notification.event-bus';

export class ManagerTaskService {
    /**
     * Get tasks with comprehensive filtering strictly within manager's scope
     */
    public static async getTasks(
        scope: ManagerAccessScope,
        query: {
            page?: number;
            limit?: number;
            projectId?: string;
            employeeId?: string;
            statusId?: string;
            priority?: string;
            isOverdue?: boolean;
            isBlocked?: boolean;
            isReopened?: boolean;
            search?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        }
    ) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        // Base scope match
        const filter: any = {
            companyId: scope.companyId,
            $or: [
                { projectId: { $in: scope.allAccessibleProjectIds } },
                { assignedToId: { $in: scope.allAccessibleEmployeeIds } },
                { createdBy: scope.managerId },
            ],
        };

        if (query.projectId) {
            if (!Types.ObjectId.isValid(query.projectId)) throw AppError.badRequest('Invalid projectId');
            await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), query.projectId);
            filter.projectId = new Types.ObjectId(query.projectId);
            delete filter.$or;
        }

        if (query.employeeId) {
            if (!Types.ObjectId.isValid(query.employeeId)) throw AppError.badRequest('Invalid employeeId');
            await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), query.employeeId);
            filter.assignedToId = new Types.ObjectId(query.employeeId);
        }

        if (query.statusId && Types.ObjectId.isValid(query.statusId)) {
            filter.statusId = new Types.ObjectId(query.statusId);
        }

        if (query.priority) {
            filter.priority = query.priority.toUpperCase();
        }

        if (query.isBlocked) {
            filter.priority = { $in: ['BLOCKER', 'CRITICAL'] };
        }

        if (query.isReopened) {
            filter.isReopen = true;
        }

        if (query.isOverdue) {
            filter.dueDate = { $lt: new Date() };
            filter.progress = { $lt: 100 };
        }

        if (query.search && query.search.trim()) {
            const regex = new RegExp(query.search.trim(), 'i');
            filter.$and = filter.$and || [];
            filter.$and.push({
                $or: [{ title: regex }, { taskNumber: regex }, { ticketId: regex }],
            });
        }

        const sortObj: any = {};
        const sortBy = query.sortBy || 'createdAt';
        sortObj[sortBy] = query.sortOrder === 'asc' ? 1 : -1;

        const [tasks, total] = await Promise.all([
            Task.find(filter)
                .populate('projectId', 'name status priority')
                .populate('assignedToId', 'name email avatar')
                .populate('createdBy', 'name email avatar')
                .populate('statusId', 'name isCompleted')
                .populate('stageId', 'name orderIndex')
                .sort(sortObj)
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
                ticketId: t.ticketId,
                project: t.projectId ? { id: t.projectId._id, name: t.projectId.name } : null,
                assignedTo: t.assignedToId ? { id: t.assignedToId._id, name: t.assignedToId.name, email: t.assignedToId.email, avatar: t.assignedToId.avatar } : null,
                createdBy: t.createdBy ? { id: t.createdBy._id, name: t.createdBy.name, avatar: t.createdBy.avatar } : null,
                status: t.statusId ? { id: t.statusId._id, name: t.statusId.name, isCompleted: t.statusId.isCompleted } : null,
                stage: t.stageId ? { id: t.stageId._id, name: t.stageId.name } : null,
                priority: t.priority,
                progress: t.progress,
                dueDate: t.dueDate,
                deliveryDate: t.deliveryDate,
                estimatedTime: t.estimatedTime,
                actualHours: t.actualHours,
                isReopen: !!t.isReopen,
                createdAt: t.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get single task details
     */
    public static async getTaskById(scope: ManagerAccessScope, taskIdStr: string) {
        await TeamAccessService.assertTaskAccess(scope.companyId.toString(), scope.managerId.toString(), taskIdStr);

        const task = await Task.findOne({ _id: taskIdStr, companyId: scope.companyId })
            .populate('projectId', 'name status priority')
            .populate('assignedToId', 'name email avatar phoneNumber status')
            .populate('createdBy', 'name email avatar')
            .populate('statusId', 'name isCompleted')
            .populate('stageId', 'name orderIndex')
            .populate('moduleId', 'name')
            .populate('sprintId', 'name status')
            .populate('releaseId', 'name version')
            .lean();

        if (!task) throw AppError.notFound('Task not found');

        const assignments = await TaskAssignment.find({ taskId: taskIdStr })
            .populate('assignedToId', 'name email avatar')
            .populate('assignedById', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        return {
            task,
            assignmentHistory: assignments,
        };
    }

    /**
     * Create task within manager scope
     */
    public static async createTask(scope: ManagerAccessScope, data: any) {
        if (!data.projectId || !Types.ObjectId.isValid(data.projectId)) {
            throw AppError.badRequest('Valid projectId is required');
        }

        // Validate project is accessible
        await TeamAccessService.assertProjectAccess(scope.companyId.toString(), scope.managerId.toString(), data.projectId);

        // If assigning to an employee, validate employee is in manager scope
        if (data.assignedToId) {
            await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), data.assignedToId);
        }

        // Reuse existing TaskService to handle itemNumbering, quota, templates, and notifications
        return TaskService.createTask(data, scope.companyId.toString(), scope.managerId.toString());
    }

    /**
     * Update task
     */
    public static async updateTask(scope: ManagerAccessScope, taskIdStr: string, data: any) {
        await TeamAccessService.assertTaskAccess(scope.companyId.toString(), scope.managerId.toString(), taskIdStr);

        if (data.assignedToId) {
            await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), data.assignedToId);
        }

        return TaskService.updateTask(taskIdStr, data, scope.companyId.toString(), scope.managerId.toString());
    }

    /**
     * Reassign task
     */
    public static async assignTask(scope: ManagerAccessScope, taskIdStr: string, newAssigneeIdStr: string) {
        await TeamAccessService.assertTaskAccess(scope.companyId.toString(), scope.managerId.toString(), taskIdStr);
        await TeamAccessService.assertEmployeeAccess(scope.companyId.toString(), scope.managerId.toString(), newAssigneeIdStr);

        const task = await Task.findOne({ _id: taskIdStr, companyId: scope.companyId });
        if (!task) throw AppError.notFound('Task not found');

        const newAssignee = await User.findById(newAssigneeIdStr).lean();
        if (!newAssignee) throw AppError.notFound('Target employee not found');

        task.assignedToId = new Types.ObjectId(newAssigneeIdStr);
        await task.save();

        // Create assignment record
        await TaskAssignment.create({
            companyId: scope.companyId,
            projectId: task.projectId,
            taskId: task._id,
            assignedToId: new Types.ObjectId(newAssigneeIdStr),
            assignedToName: newAssignee.name || '',
            assignedById: scope.managerId,
            assignedAt: new Date(),
            isActive: true,
        });

        // Record activity
        await TaskActivity.create({
            companyId: scope.companyId,
            projectId: task.projectId,
            taskId: task._id,
            userId: scope.managerId,
            type: ActivityType.SYSTEM,
            content: `Task reassigned to ${newAssignee.name}`,
        });

        // Publish notification
        NotificationEventBus.getInstance().publish({
            type: 'TASK_ASSIGNED',
            companyId: scope.companyId.toString(),
            actorId: scope.managerId.toString(),
            entityId: task._id.toString(),
            entityType: 'TASK',
            recipientIds: [newAssigneeIdStr],
            projectId: task.projectId.toString(),
            taskId: task._id.toString(),
            metadata: {
                taskTitle: task.title,
                taskNumber: task.taskNumber || '',
                reassignedBy: scope.managerId.toString(),
            },
        });

        return this.getTaskById(scope, taskIdStr);
    }

    /**
     * Update task status
     */
    public static async updateStatus(scope: ManagerAccessScope, taskIdStr: string, statusIdStr: string) {
        await TeamAccessService.assertTaskAccess(scope.companyId.toString(), scope.managerId.toString(), taskIdStr);

        if (!Types.ObjectId.isValid(statusIdStr)) throw AppError.badRequest('Invalid statusId');

        const task = await Task.findOne({ _id: taskIdStr, companyId: scope.companyId });
        if (!task) throw AppError.notFound('Task not found');

        task.statusId = new Types.ObjectId(statusIdStr);
        await task.save();

        return this.getTaskById(scope, taskIdStr);
    }

    /**
     * Update task priority
     */
    public static async updatePriority(scope: ManagerAccessScope, taskIdStr: string, priority: string) {
        await TeamAccessService.assertTaskAccess(scope.companyId.toString(), scope.managerId.toString(), taskIdStr);

        const task = await Task.findOne({ _id: taskIdStr, companyId: scope.companyId });
        if (!task) throw AppError.notFound('Task not found');

        task.priority = priority.toUpperCase() as any;
        await task.save();

        return this.getTaskById(scope, taskIdStr);
    }
}
export default ManagerTaskService;
