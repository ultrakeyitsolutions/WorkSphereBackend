import { Types } from 'mongoose';
import { Task } from './task.model';
import { RecurringRule } from './recurring-rule.model';
import { Project, ProjectSettings, ProjectTeamMember, ProjectInCharge } from '../companyadmin/projects/project.model';
import { EntitlementService } from '../../services/entitlement.service';

export class TaskService {
    static async getTaskContext(projectId: string, companyId: string, userId: string) {
        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const settings = await ProjectSettings.findOne({ projectId }).lean();

        // Members checking
        const teamMembers = await ProjectTeamMember.find({ projectId }).populate('userId', 'firstName lastName email').lean();
        const inCharges = await ProjectInCharge.find({ projectId }).populate('userId', 'firstName lastName email').lean();

        const allMembers = [];
        const seen = new Set();

        for (const tm of teamMembers) {
            const uid = tm.userId?._id?.toString();
            if (uid && !seen.has(uid)) {
                seen.add(uid);
                allMembers.push({
                    id: uid,
                    name: `${(tm.userId as any)?.firstName || ''} ${(tm.userId as any)?.lastName || ''}`.trim(),
                    isActive: true,
                    canCreateTasks: tm.canCreateTasks
                });
            }
        }
        for (const ic of inCharges) {
            const uid = ic.userId?._id?.toString();
            if (uid && !seen.has(uid)) {
                seen.add(uid);
                allMembers.push({
                    id: uid,
                    name: `${(ic.userId as any)?.firstName || ''} ${(ic.userId as any)?.lastName || ''}`.trim(),
                    isActive: true,
                    canCreateTasks: true
                });
            }
        }

        let canCreateTask = false;
        if (project.createdById.toString() === userId) {
            canCreateTask = true;
        } else {
            const isManager = inCharges.some(ic => ic.userId?._id?.toString() === userId);
            if (isManager) canCreateTask = true;
            else {
                const tm = teamMembers.find(t => t.userId?._id?.toString() === userId);
                if (tm && tm.canCreateTasks && settings?.allowTeamMembersToCreateTasks) {
                    canCreateTask = true;
                } else if (tm && !settings) {
                    canCreateTask = true;
                }
            }
        }

        const recurringTasksFeature = await EntitlementService.hasFeature(companyId, 'RECURRING_TASKS');

        return {
            project: {
                id: project._id,
                name: project.name,
                allowTeamMembersToCreateTasks: settings?.allowTeamMembersToCreateTasks ?? true,
            },
            modules: [
                { id: 'general', name: 'General', isActive: true }
            ],
            members: allMembers,
            permissions: { canCreateTask },
            features: { recurringTasks: recurringTasksFeature }
        };
    }

    static async createTask(data: any, companyId: string, userId: string) {
        const { projectId, moduleId, assignedToId, isRecurring, recurrence, ...taskData } = data;

        const project = await Project.findOne({ _id: projectId, companyId, isArchived: false, isActive: true }).lean();
        if (!project) throw new Error('PROJECT_NOT_FOUND');

        const isOwner = project.createdById.toString() === userId;
        const isInCharge = await ProjectInCharge.exists({ projectId, userId });
        const tm = await ProjectTeamMember.findOne({ projectId, userId }).lean();
        const settings = await ProjectSettings.findOne({ projectId }).lean();

        let canCreateTask = isOwner || !!isInCharge;
        if (!canCreateTask && tm) {
            canCreateTask = settings ? (settings.allowTeamMembersToCreateTasks && tm.canCreateTasks) : true;
        }

        if (!canCreateTask) throw new Error('PERMISSION_DENIED');

        if (assignedToId) {
            const assignedInCharge = await ProjectInCharge.exists({ projectId, userId: assignedToId });
            const assignedTm = await ProjectTeamMember.exists({ projectId, userId: assignedToId });
            const assignedOwner = project.createdById.toString() === assignedToId;
            if (!assignedInCharge && !assignedTm && !assignedOwner) {
                throw new Error('ASSIGNEE_NOT_IN_PROJECT');
            }
        }

        if (isRecurring) {
            const hasRecurring = await EntitlementService.hasFeature(companyId, 'RECURRING_TASKS');
            if (!hasRecurring) {
                throw new Error('FEATURE_NOT_AVAILABLE');
            }

            const rule = await RecurringRule.create({
                projectId,
                moduleId: moduleId && moduleId !== 'general' ? moduleId : undefined,
                createdBy: userId,
                assignedToId,
                title: taskData.title,
                description: taskData.description,
                type: recurrence.type,
                interval: recurrence.interval,
                daysOfWeek: recurrence.daysOfWeek,
                dayOfMonth: recurrence.dayOfMonth,
                startDate: new Date(recurrence.startDate),
                endDate: recurrence.endDate ? new Date(recurrence.endDate) : undefined,
                maxOccurrences: recurrence.maxOccurrences,
                useSpecificTime: recurrence.useSpecificTime,
                startTime: recurrence.startTime,
                endTime: recurrence.endTime
            });

            const task = await Task.create({
                ...taskData,
                projectId,
                moduleId: moduleId && moduleId !== 'general' ? moduleId : undefined,
                createdBy: userId,
                assignedToId,
                isRecurring: true,
                recurringRuleId: rule._id,
                itemNumber: await this.getNextItemNumber(projectId)
            });

            return { task, rule };
        } else {
            const task = await Task.create({
                ...taskData,
                projectId,
                moduleId: moduleId && moduleId !== 'general' ? moduleId : undefined,
                createdBy: userId,
                assignedToId,
                isRecurring: false,
                itemNumber: await this.getNextItemNumber(projectId)
            });
            return { task };
        }
    }

    private static async getNextItemNumber(projectId: string): Promise<number> {
        const lastTask = await Task.findOne({ projectId }).sort({ itemNumber: -1 }).lean();
        return lastTask && lastTask.itemNumber ? lastTask.itemNumber + 1 : 1;
    }
}
