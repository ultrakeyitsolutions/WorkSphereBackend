import { Types } from 'mongoose';
import { TaskAttachment } from './task-attachment.model';
import { Task } from '../tasks/task.model';

export class TaskAttachmentService {
    static async createAttachment(taskId: string, userId: string, companyId: string, data: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const attachment = new TaskAttachment({
            companyId: new Types.ObjectId(companyId),
            projectId: task.projectId,
            taskId: task._id,
            uploadedBy: new Types.ObjectId(userId),
            fileName: data.fileName,
            originalName: data.originalName,
            storageKey: data.storageKey,
            url: data.url,
            mimeType: data.mimeType,
            size: data.size,
            type: data.type
        });

        await attachment.save();
        return TaskAttachment.findById(attachment._id).populate('uploadedBy', 'id name avatar role').exec();
    }

    static async getAttachments(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        return TaskAttachment.find({ taskId: task._id, companyId })
            .sort({ createdAt: -1 })
            .populate('uploadedBy', 'id name avatar role')
            .exec();
    }

    static async deleteAttachment(attachmentId: string, companyId: string) {
        const attachment = await TaskAttachment.findOneAndDelete({ _id: attachmentId, companyId });
        if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');
        return true;
    }
}
