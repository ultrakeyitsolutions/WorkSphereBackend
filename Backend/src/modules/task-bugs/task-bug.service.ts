import { Types } from 'mongoose';
import { TaskBug } from './task-bug.model';
import { Task } from '../tasks/task.model';

export class TaskBugService {
    static async createBug(taskId: string, userId: string, companyId: string, data: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const bug = new TaskBug({
            companyId: new Types.ObjectId(companyId),
            projectId: task.projectId,
            taskId: task._id,
            createdBy: new Types.ObjectId(userId),
            title: data.title,
            description: data.description,
            priority: data.priority,
            assignedTo: data.assignedTo || null
        });

        await bug.save();
        return TaskBug.findById(bug._id).populate('createdBy', 'id name avatar role').populate('assignedTo', 'id name avatar role').exec();
    }

    static async getBugs(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        return TaskBug.find({ taskId: task._id, companyId })
            .sort({ createdAt: -1 })
            .populate('createdBy', 'id name avatar role')
            .populate('assignedTo', 'id name avatar role')
            .exec();
    }

    static async getBugById(bugId: string, companyId: string) {
        const bug = await TaskBug.findOne({ _id: bugId, companyId })
            .populate('createdBy', 'id name avatar role')
            .populate('assignedTo', 'id name avatar role');

        if (!bug) throw new Error('BUG_NOT_FOUND');
        return bug;
    }

    static async updateBug(bugId: string, companyId: string, data: any) {
        const bug = await TaskBug.findOneAndUpdate(
            { _id: bugId, companyId },
            { $set: data },
            { new: true }
        ).populate('createdBy', 'id name avatar role').populate('assignedTo', 'id name avatar role');

        if (!bug) throw new Error('BUG_NOT_FOUND');
        return bug;
    }

    static async deleteBug(bugId: string, companyId: string) {
        const bug = await TaskBug.findOneAndDelete({ _id: bugId, companyId });
        if (!bug) throw new Error('BUG_NOT_FOUND');
        return true;
    }
}
