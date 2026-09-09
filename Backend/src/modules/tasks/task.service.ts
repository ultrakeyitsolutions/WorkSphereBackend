import mongoose, { Types } from 'mongoose';
import { Task } from './task.model';
import { RecurringRule } from './recurring-rule.model';
import { Project, ProjectTeamMember, ProjectInCharge, ProjectSettings } from '../companyadmin/projects/project.model';
import { ProjectService } from '../companyadmin/projects/project.service';
import { EntitlementService } from '../../services/entitlement.service';
import { User } from '../users/user.model';
import { UserService } from '../users/user.service';
import { Stage } from './stage.model';
import { Status } from './status.model';
import { TaskAssignment } from './task-assignment.model';

export class TaskService {

    // ─── Shared Task Mapper ───────────────────────────────────────────────────
    private static mapTaskResponse(t: any, projectName: string) {
        return {
            id: t._id,
            title: t.title,
            itemNumber: t.itemNumber,
            taskNumber: t.taskNumber,
            ticketId: t.ticketId,
            projectId: t.projectId,
            projectName,
            moduleId: t.moduleId ? t.moduleId._id : null,
            moduleName: t.moduleId ? t.moduleId.name : null,
            statusId: t.statusId ? t.statusId._id : null,
            status: t.statusId ? { id: t.statusId._id, name: t.statusId.name } : null,
            stageId: t.stageId ? t.stageId._id : null,
            stage: t.stageId ? { id: t.stageId._id, name: t.stageId.name, orderIndex: t.stageId.orderIndex } : null,
            assignedTo: t.assignedToId
                ? {
                    id: t.assignedToId._id,
                    fullName: t.assignedToId.name || '',
                    email: t.assignedToId.email,
                    avatar: t.assignedToId.avatar || null
                }
                : null,
            createdBy: t.createdBy
                ? {
                    id: t.createdBy._id,
                    fullName: t.createdBy.name || '',
                    email: t.createdBy.email,
                    avatar: t.createdBy.avatar || null
                }
                : null,
            priority: t.priority,
            taskType: t.taskType,
            criticality: t.criticality,
            startDate: t.startDate || null,
            endDate: t.endDate || null,
            dueDate: t.dueDate || null,
            completedDate: t.completedDate || null,
            estimatedTime: t.estimatedTime,
            actualHours: t.actualHours,
            progress: t.progress,
            deliveryDate: t.deliveryDate || null,
            tags: t.tags || [],
            notesCount: (t.notes || []).length,
            checklist: (t.checklist || []).map((item: any) => ({
                _id: item._id ? item._id.toString() : undefined,
                id: item._id ? item._id.toString() : undefined,
                title: item.title,
                isCompleted: Boolean(item.isCompleted),
                notes: item.notes || null,
                completedById: item.completedById ? item.completedById.toString() : null,
                completedAt: item.completedAt || null
            })),
            checklistItemsCount: (t.checklist || []).length,
            documentCount: (t.attachments || []).length,
            isUseTemplate: t.isUseTemplate || false,
            templateId: t.templateId ? t.templateId._id : null,
            templateName: t.templateId ? t.templateId.name : null,
            isRecurring: t.isRecurring,
            recurringRuleId: t.recurringRuleId || null,
            // Reopen tracking
            isReopen: t.isReopen || false,
            reopenedFromTaskId: t.reopenedFromTaskId || null,
            reopenedFromTaskNumber: t.reopenedFromTaskNumber || null,
            reopenReason: t.reopenReason || null,
            isPinned: t.isPinned,
            isActive: t.isActive,
            isArchived: t.isArchived,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt
        };
    }

    // ─── Task Context ─────────────────────────────────────────────────────────
    static async getTaskContext(projectId: string, companyId: string, userId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const settings = await ProjectSettings.findOne({ projectId }).lean();

        const teamMembers = await ProjectTeamMember.find({ projectId })
            .populate('userId', 'name email avatar')
            .lean();
        const inCharges = await ProjectInCharge.find({ projectId })
            .populate('userId', 'name email avatar')
            .lean();

        const allMembers: any[] = [];
        const seen = new Set<string>();

        const pushMember = (user: any, role: string, canCreateTasks = true) => {
            const uid = user?._id?.toString();
            if (!uid || seen.has(uid)) return;
            seen.add(uid);
            allMembers.push({
                id: uid,
                fullName: user?.name || '',
                email: user?.email || '',
                avatar: user?.avatar || null,
                role,
                isActive: true,
                canCreateTasks
            });
        };

        for (const ic of inCharges) pushMember(ic.userId, 'Manager', true);
        for (const tm of teamMembers) pushMember(tm.userId, 'Member', tm.canCreateTasks);

        // Include project owner
        const ownerUid = project.createdById?.toString();
        if (ownerUid && !seen.has(ownerUid)) {
            allMembers.unshift({ id: ownerUid, fullName: 'Project Owner', role: 'Owner', isActive: true, canCreateTasks: true });
        }

        let canCreateTask = project.createdById.toString() === userId;
        if (!canCreateTask) {
            const isManager = inCharges.some(ic => ic.userId?._id?.toString() === userId);
            if (isManager) {
                canCreateTask = true;
            } else {
                const tm = teamMembers.find(t => t.userId?._id?.toString() === userId);
                if (tm && tm.canCreateTasks && (settings?.allowTeamMembersToCreateTasks ?? true)) {
                    canCreateTask = true;
                }
            }
        }

        const recurringTasksFeature = await EntitlementService.hasFeature(companyId, 'RECURRING_TASKS');

        return {
            project: { id: project._id, name: project.name },
            modules: [{ id: 'general', name: 'General', isActive: true }],
            members: allMembers,
            stages: [],           // Extend when Stage model is added
            taskTemplates: [],    // Extend when TaskTemplate model is added
            priorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
            features: { recurringTasks: recurringTasksFeature },
            permissions: { canCreateTask }
        };
    }

    // ─── Create Task ──────────────────────────────────────────────────────────
    static async createTask(data: any, companyId: string, userId: string) {
        const {
            projectId,
            moduleId,
            assignedToId,
            isRecurring,
            recurrence,
            ...taskData
        } = data;

        // 1. Validate project belongs to company
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        // 2. Check create permission: Must have Project Access AND TASK_CREATE permission
        const canAccess = await ProjectService.canAccessProject(companyId, userId, projectId);
        if (!canAccess) throw new Error('PERMISSION_DENIED'); // Uses PERMISSION_DENIED to map to 403 Forbidden in controller

        const hasTaskCreate = await UserService.hasPermission(userId, 'TASK_CREATE');
        if (!hasTaskCreate) {
            // Reusing PERMISSION_DENIED to map to existing controller error handling
            throw new Error('PERMISSION_DENIED');
        }

        // 3. Validate assignedToId is a project member
        if (assignedToId) {
            const isOwner = project.createdById.toString() === assignedToId;
            const isInCharge = await ProjectInCharge.exists({ projectId, userId: assignedToId });
            const isMember = await ProjectTeamMember.exists({ projectId, userId: assignedToId });
            if (!isOwner && !isInCharge && !isMember) throw new Error('ASSIGNEE_NOT_IN_PROJECT');
        }

        // 4. Resolve effective moduleId
        const effectiveModuleId = moduleId && moduleId !== 'general' ? moduleId : undefined;

        // 4.5 Resolve initial stage and status
        let initialStageId = taskData.stageId;
        if (!initialStageId) {
            const defaultStage = await Stage.findOne({ projectId, isDefault: true }).lean();
            if (defaultStage) initialStageId = defaultStage._id;
        }

        let initialStatusId = taskData.statusId;
        if (!initialStatusId) {
            const defaultStatus = await Status.findOne({ companyId, isMaster: true, orderIndex: 1 }).lean();
            if (defaultStatus) initialStatusId = defaultStatus._id;
        }

        // 5. Generate item number
        const itemNumber = await this.getNextItemNumber(projectId);
        const taskNumber = String(itemNumber).padStart(3, '0');

        if (isRecurring) {
            // 6a. Recurring task — check entitlement first
            const hasRecurring = await EntitlementService.hasFeature(companyId, 'RECURRING_TASKS');
            if (!hasRecurring) throw new Error('FEATURE_NOT_AVAILABLE');

            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                // Recurrence fields take priority over task-level fields
                const recModuleId = recurrence.moduleId && recurrence.moduleId !== 'general'
                    ? recurrence.moduleId
                    : effectiveModuleId;

                const rule = new RecurringRule({
                    companyId,
                    projectId,
                    moduleId: recModuleId,
                    createdBy: userId,
                    assignedToId: recurrence.assignedToId || assignedToId,
                    title: taskData.title,
                    priority: recurrence.priority || taskData.priority || 'MEDIUM',
                    taskType: recurrence.taskType || taskData.taskType || 'TASK',
                    criticality: recurrence.criticality || taskData.criticality || 'NON_CRITICAL',
                    estimatedTime: recurrence.estimatedTime || taskData.estimatedTime,
                    tags: recurrence.tags || taskData.tags,
                    notes: recurrence.notes || taskData.notes,
                    attachments: recurrence.attachments || [],
                    checklist: recurrence.checklist || [],
                    pattern: recurrence.pattern,
                    repeatEvery: recurrence.repeatEvery ?? 1,
                    daysOfWeek: recurrence.daysOfWeek,
                    dayOfMonth: recurrence.dayOfMonth,
                    month: recurrence.month,
                    startDateTime: new Date(recurrence.startDateTime),
                    endDateTime: recurrence.endDateTime ? new Date(recurrence.endDateTime) : undefined,
                    maxOccurrences: recurrence.maxOccurrences,
                    templateId: recurrence.templateId || taskData.templateId
                });
                await rule.save({ session });

                const task = new Task({
                    ...taskData,
                    companyId,
                    projectId,
                    moduleId: effectiveModuleId,
                    stageId: initialStageId,
                    statusId: initialStatusId,
                    createdBy: userId,
                    assignedToId,
                    itemNumber,
                    taskNumber,
                    isUseTemplate: !!taskData.templateId || !!recurrence.templateId,
                    templateId: recurrence.templateId || taskData.templateId,
                    isRecurring: true,
                    recurringRuleId: rule._id
                });
                await task.save({ session });

                if (assignedToId) {
                    const assignedUser = await User.findById(assignedToId).lean();
                    if (assignedUser) {
                        await TaskAssignment.create([{
                            companyId,
                            projectId,
                            taskId: task._id,
                            assignedToId,
                            assignedToName: assignedUser.name || '',
                            assignedById: userId
                        }], { session });
                    }
                }

                await session.commitTransaction();
                session.endSession();

                const loadedTask = await Task.findById(task._id)
                    .populate('assignedToId', 'name email avatar')
                    .populate('createdBy', 'name email avatar')
                    .populate('stageId', 'name orderIndex')
                    .populate('statusId', 'name')
                    .populate('moduleId', 'name')
                    .populate('templateId', 'name')
                    .lean();

                return { task: this.mapTaskResponse(loadedTask, project.name), rule };
            } catch (error) {
                await session.abortTransaction();
                session.endSession();
                throw error;
            }
        } else {
            // 6b. Normal task
            const task = await Task.create({
                ...taskData,
                companyId,
                projectId,
                moduleId: effectiveModuleId,
                stageId: initialStageId,
                statusId: initialStatusId,
                createdBy: userId,
                assignedToId,
                itemNumber,
                taskNumber,
                isUseTemplate: !!taskData.templateId,
                isRecurring: false
            });

            if (assignedToId) {
                const assignedUser = await User.findById(assignedToId).lean();
                if (assignedUser) {
                    await TaskAssignment.create({
                        companyId,
                        projectId,
                        taskId: task._id,
                        assignedToId,
                        assignedToName: assignedUser.name || '',
                        assignedById: userId
                    });
                }
            }

            const loadedTask = await Task.findById(task._id)
                .populate('assignedToId', 'name email avatar')
                .populate('createdBy', 'name email avatar')
                .populate('stageId', 'name orderIndex')
                .populate('statusId', 'name')
                .populate('moduleId', 'name')
                .populate('templateId', 'name')
                .lean();

            return { task: this.mapTaskResponse(loadedTask, project.name) };
        }
    }


    static async getTasksByProject(projectId: string, companyId: string, query: any = {}) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const page = query.page || 1;
        const pageSize = query.pageSize || 50;
        const skip = (page - 1) * pageSize;

        const filter: any = { projectId, companyId, isArchived: false };
        if (query.stageId) filter.stageId = query.stageId;
        if (query.priority) filter.priority = query.priority;
        if (query.isRecurring !== undefined) filter.isRecurring = query.isRecurring;
        if (query.search) filter.title = { $regex: query.search, $options: 'i' };

        const [tasks, total] = await Promise.all([
            Task.find(filter)
                .populate('assignedToId', 'name email avatar')
                .populate('createdBy', 'name email avatar')
                .populate('stageId', 'name orderIndex')
                .populate('statusId', 'name')
                .populate('moduleId', 'name')
                .populate('templateId', 'name')
                .sort({ orderIndex: 1, createdAt: -1 })
                .skip(skip)
                .limit(pageSize)
                .lean(),
            Task.countDocuments(filter)
        ]);

        const mapped = tasks.map(t => this.mapTaskResponse(t, project.name));

        return {
            tasks: mapped,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        };
    }

    // ─── Get Task by ID ───────────────────────────────────────────────────────
    static async getTaskById(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false })
            .populate('assignedToId', 'name email avatar')
            .populate('createdBy', 'name email avatar')
            .populate('stageId', 'name orderIndex')
            .populate('statusId', 'name')
            .populate('moduleId', 'name')
            .lean();
        if (!task) throw new Error('TASK_NOT_FOUND');

        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        return this.mapTaskResponse(task, project.name);
    }

    // ─── Update Task ──────────────────────────────────────────────────────────
    static async updateTask(taskId: string, data: any, companyId: string, userId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false });
        if (!task) throw new Error('TASK_NOT_FOUND');

        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const { isRecurring, recurrence, ...taskData } = data;

        if (data.assignedToId) {
            const isOwner = project.createdById.toString() === data.assignedToId;
            const isInCharge = await ProjectInCharge.exists({ projectId: task.projectId, userId: data.assignedToId });
            const isMember = await ProjectTeamMember.exists({ projectId: task.projectId, userId: data.assignedToId });
            if (!isOwner && !isInCharge && !isMember) throw new Error('ASSIGNEE_NOT_IN_PROJECT');
        }

        let newRule: any = null;
        let createdNewRule = false;

        if (isRecurring !== undefined) {
            if (isRecurring === true && !task.isRecurring) {
                const hasRecurring = await EntitlementService.hasFeature(companyId, 'RECURRING_TASKS');
                if (!hasRecurring) throw new Error('FEATURE_NOT_AVAILABLE');

                newRule = new RecurringRule({
                    companyId,
                    projectId: task.projectId,
                    moduleId: (recurrence?.moduleId || taskData.moduleId) && (recurrence?.moduleId || taskData.moduleId) !== 'general'
                        ? (recurrence?.moduleId || taskData.moduleId)
                        : undefined,
                    createdBy: userId,
                    assignedToId: recurrence?.assignedToId || taskData.assignedToId || task.assignedToId,
                    title: taskData.title || task.title,
                    priority: taskData.priority || task.priority,
                    taskType: taskData.taskType || task.taskType,
                    criticality: taskData.criticality || task.criticality,
                    estimatedTime: taskData.estimatedTime || task.estimatedTime,
                    notes: recurrence?.notes ?? taskData.notes,
                    attachments: recurrence?.attachments ?? [],
                    checklist: recurrence?.checklist ?? [],
                    pattern: recurrence?.pattern || 'WEEKLY',
                    repeatEvery: recurrence?.repeatEvery ?? 1,
                    daysOfWeek: recurrence?.daysOfWeek,
                    dayOfMonth: recurrence?.dayOfMonth,
                    startDateTime: recurrence?.startDateTime ? new Date(recurrence.startDateTime) : new Date(),
                    endDateTime: recurrence?.endDateTime ? new Date(recurrence.endDateTime) : undefined
                });
                task.isRecurring = true;
                task.recurringRuleId = newRule._id as Types.ObjectId;
                createdNewRule = true;

            } else if (isRecurring === false && task.isRecurring) {
                if (task.recurringRuleId) {
                    await RecurringRule.updateOne({ _id: task.recurringRuleId }, { isActive: false });
                }
                task.isRecurring = false;
                task.recurringRuleId = null as any;
            }
        }

        // Update existing rule fields
        if (recurrence && task.isRecurring && task.recurringRuleId && !createdNewRule) {
            const existingRule = await RecurringRule.findOne({ _id: task.recurringRuleId });
            if (existingRule) {
                const pick = (a: any, b: any) => (a !== undefined ? a : b);
                Object.assign(existingRule, {
                    pattern: pick(recurrence.pattern, existingRule.pattern),
                    repeatEvery: pick(recurrence.repeatEvery, existingRule.repeatEvery),
                    daysOfWeek: pick(recurrence.daysOfWeek, existingRule.daysOfWeek),
                    dayOfMonth: pick(recurrence.dayOfMonth, existingRule.dayOfMonth),
                    startDateTime: recurrence.startDateTime ? new Date(recurrence.startDateTime) : existingRule.startDateTime,
                    endDateTime: recurrence.endDateTime ? new Date(recurrence.endDateTime) : existingRule.endDateTime,
                    notes: pick(recurrence.notes, existingRule.notes),
                    attachments: pick(recurrence.attachments, existingRule.attachments),
                    checklist: pick(recurrence.checklist, existingRule.checklist),
                    assignedToId: pick(recurrence.assignedToId, existingRule.assignedToId),
                    moduleId: pick(recurrence.moduleId, existingRule.moduleId)
                });
                await existingRule.save();
            }
        }

        Object.assign(task, taskData);

        if (createdNewRule) {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                await newRule.save({ session });
                await task.save({ session });
                await session.commitTransaction();
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
        } else {
            await task.save();
        }

        return task;
    }

    // ─── Soft Delete Task ─────────────────────────────────────────────────────
    static async deleteTask(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false });
        if (!task) throw new Error('TASK_NOT_FOUND');
        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        task.isArchived = true;
        task.isActive = false;
        await task.save();

        if (task.recurringRuleId) {
            await RecurringRule.updateOne({ _id: task.recurringRuleId }, { isActive: false });
        }
        return true;
    }

    // ─── Recurrence Management ────────────────────────────────────────────────
    static async getTaskRecurrence(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false }).lean();
        if (!task) throw new Error('TASK_NOT_FOUND');
        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');
        if (!task.recurringRuleId) return null;
        return RecurringRule.findOne({ _id: task.recurringRuleId }).lean();
    }

    static async updateTaskRecurrence(taskId: string, recurrence: any, companyId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false }).lean();
        if (!task) throw new Error('TASK_NOT_FOUND');
        if (!task.isRecurring || !task.recurringRuleId) throw new Error('NOT_RECURRING');
        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');
        const rule = await RecurringRule.findOne({ _id: task.recurringRuleId });
        if (!rule) throw new Error('RULE_NOT_FOUND');

        const pick = (a: any, b: any) => (a !== undefined ? a : b);
        Object.assign(rule, {
            pattern: pick(recurrence.pattern, rule.pattern),
            repeatEvery: pick(recurrence.repeatEvery, rule.repeatEvery),
            daysOfWeek: pick(recurrence.daysOfWeek, rule.daysOfWeek),
            dayOfMonth: pick(recurrence.dayOfMonth, rule.dayOfMonth),
            startDateTime: recurrence.startDateTime ? new Date(recurrence.startDateTime) : rule.startDateTime,
            endDateTime: recurrence.endDateTime ? new Date(recurrence.endDateTime) : rule.endDateTime,
            maxOccurrences: pick(recurrence.maxOccurrences, rule.maxOccurrences),
            notes: pick(recurrence.notes, rule.notes),
            attachments: pick(recurrence.attachments, rule.attachments),
            checklist: pick(recurrence.checklist, rule.checklist),
            assignedToId: pick(recurrence.assignedToId, rule.assignedToId),
            moduleId: pick(recurrence.moduleId, rule.moduleId)
        });
        await rule.save();
        return rule;
    }

    static async deleteTaskRecurrence(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, isArchived: false });
        if (!task) throw new Error('TASK_NOT_FOUND');
        const project = await Project.findOne({ _id: task.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');
        if (task.recurringRuleId) {
            await RecurringRule.updateOne({ _id: task.recurringRuleId }, { isActive: false });
        }
        task.isRecurring = false;
        task.recurringRuleId = null as any;
        await task.save();
        return true;
    }

    // ─── Atomic Item Number Generator ─────────────────────────────────────────
    private static async getNextItemNumber(projectId: string): Promise<number> {
        const settings = await ProjectSettings.findOneAndUpdate(
            { projectId },
            { $inc: { lastTaskItemNumber: 1 } },
            { new: true, upsert: true }
        );
        return settings.lastTaskItemNumber;
    }

    // ─── Reopen Task ──────────────────────────────────────────────────────────
    /**
     * Reopens a completed task by creating a new task that references the original.
     * Only available when the task's current stage is named "Completed".
     * The assignee must be a member of the project.
     */
    static async reopenTask(
        taskId: string,
        data: { reopenReason: string; assignedToId?: string },
        companyId: string,
        userId: string
    ) {
        // 1. Load the original task
        const originalTask = await Task.findOne({ _id: taskId, companyId, isArchived: false })
            .populate('stageId', 'name')
            .lean();
        if (!originalTask) throw new Error('TASK_NOT_FOUND');

        // 2. Validate project
        const project = await Project.findOne({ _id: originalTask.projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        // 3. Task must be in the "Completed" stage
        const stageName = (originalTask.stageId as any)?.name || '';
        if (stageName !== 'Completed') {
            throw new Error('TASK_NOT_COMPLETED');
        }

        // 4. Validate assignee is a project member (if provided)
        const assignedToId = data.assignedToId;
        if (assignedToId) {
            const isOwner = project.createdById.toString() === assignedToId;
            const isInCharge = await ProjectInCharge.exists({ projectId: originalTask.projectId, userId: assignedToId });
            const isMember = await ProjectTeamMember.exists({ projectId: originalTask.projectId, userId: assignedToId });
            if (!isOwner && !isInCharge && !isMember) throw new Error('ASSIGNEE_NOT_IN_PROJECT');
        }

        // 5. Generate a new task number
        const itemNumber = await this.getNextItemNumber(String(originalTask.projectId));
        const taskNumber = String(itemNumber).padStart(3, '0');

        // 6. Resolve the default "New" / initial stage for the project
        const defaultStage = await Stage.findOne({ projectId: originalTask.projectId, isDefault: true }).lean();

        // 7. Resolve the initial status
        const defaultStatus = await Status.findOne({ companyId, isMaster: true, orderIndex: 1 }).lean();

        // 8. Create the reopened task
        const reopenedTask = await Task.create({
            companyId,
            projectId: originalTask.projectId,
            moduleId: originalTask.moduleId,
            title: originalTask.title,
            ticketId: originalTask.ticketId,
            taskType: originalTask.taskType,
            criticality: originalTask.criticality,
            priority: originalTask.priority,
            tags: originalTask.tags,
            estimatedTime: originalTask.estimatedTime,
            // Stage: go back to the default ("New") stage
            stageId: defaultStage?._id,
            // Status: back to the first status (orderIndex 1 = "New")
            statusId: defaultStatus?._id,
            createdBy: userId,
            assignedToId: assignedToId || originalTask.assignedToId,
            itemNumber,
            taskNumber,
            // Reopen tracking
            isReopen: true,
            reopenedFromTaskId: originalTask._id,
            reopenedFromTaskNumber: originalTask.taskNumber,
            reopenReason: data.reopenReason,
            isRecurring: false,
            isUseTemplate: false
        });

        // 9. Track assignment history
        const effectiveAssigneeId = assignedToId || (originalTask.assignedToId ? String(originalTask.assignedToId) : null);
        if (effectiveAssigneeId) {
            const assignedUser = await User.findById(effectiveAssigneeId).lean();
            if (assignedUser) {
                await TaskAssignment.create({
                    companyId,
                    projectId: originalTask.projectId,
                    taskId: reopenedTask._id,
                    assignedToId: effectiveAssigneeId,
                    assignedToName: assignedUser.name || '',
                    assignedById: userId
                });
            }
        }

        // 10. Load and return the full task
        const loadedTask = await Task.findById(reopenedTask._id)
            .populate('assignedToId', 'name email avatar')
            .populate('createdBy', 'name email avatar')
            .populate('stageId', 'name orderIndex')
            .populate('statusId', 'name')
            .populate('moduleId', 'name')
            .lean();

        return {
            id: loadedTask!._id,
            taskNumber: loadedTask!.taskNumber,
            reopenedFromTaskId: originalTask._id,
            reopenedFromTaskNumber: originalTask.taskNumber,
            isReopen: true,
            status: 1,
            statusName: 'Reopened',
            stageId: (loadedTask!.stageId as any)?._id || null,
            reopenReason: data.reopenReason,
            removedFromDelivery: false,
            message: 'Task reopened successfully',
            task: this.mapTaskResponse(loadedTask, project.name)
        };
    }

    // ─── Get Project Members (for reopen assignment) ───────────────────────────
    static async getProjectMembers(projectId: string, companyId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const teamMembers = await ProjectTeamMember.find({ projectId })
            .populate('userId', 'name email avatar')
            .lean();
        const inCharges = await ProjectInCharge.find({ projectId })
            .populate('userId', 'name email avatar')
            .lean();

        const members: any[] = [];
        const seen = new Set<string>();

        const push = (user: any, role: string) => {
            const uid = user?._id?.toString();
            if (!uid || seen.has(uid)) return;
            seen.add(uid);
            members.push({
                id: uid,
                fullName: user?.name || '',
                email: user?.email || '',
                avatar: user?.avatar || null,
                role
            });
        };

        for (const ic of inCharges) push(ic.userId, 'Manager');
        for (const tm of teamMembers) push(tm.userId, 'Member');

        // Include project owner
        const ownerUid = project.createdById?.toString();
        if (ownerUid && !seen.has(ownerUid)) {
            members.unshift({ id: ownerUid, fullName: 'Project Owner', role: 'Owner', email: '', avatar: null });
        }

        return members;
    }
}
