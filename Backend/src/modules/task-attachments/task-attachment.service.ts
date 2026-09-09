import { Types } from 'mongoose';
import { TaskAttachment } from './task-attachment.model';
import { Task } from '../tasks/task.model';

export class TaskAttachmentService {
    static async createAttachment(taskId: string, userId: string, companyId: string, data: any) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const filePath = data.filePath || data.url || '';
        const url = data.url || data.filePath || '';
        const storageKey = data.storageKey || filePath || data.fileName;
        const originalName = data.originalName || data.fileName;
        const size = data.fileSize ?? data.size ?? 0;
        const mimeType = data.contentType || data.mimeType || 'application/octet-stream';

        let type = data.type || data.fileType || 'OTHER';
        const upperType = String(type).toUpperCase();
        if (['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'OTHER'].includes(upperType)) {
            type = upperType;
        } else {
            type = 'DOCUMENT';
        }

        const attachment = new TaskAttachment({
            companyId: new Types.ObjectId(companyId),
            projectId: task.projectId,
            taskId: task._id,
            uploadedBy: new Types.ObjectId(userId),
            fileName: data.fileName,
            originalName,
            storageKey,
            url,
            filePath,
            fileType: data.fileType || (type === 'IMAGE' ? 'image' : 'document'),
            fileSize: size,
            contentType: mimeType,
            mimeType,
            size,
            type,
            youtubeVideoId: data.youtubeVideoId || null,
            uploadedAt: new Date()
        });

        await attachment.save();

        // Also sync with task.attachments
        await Task.updateOne(
            { _id: task._id },
            {
                $push: {
                    attachments: {
                        fileName: data.fileName,
                        fileUrl: url || filePath,
                        fileType: data.fileType || type,
                        fileSize: size,
                        uploadedById: new Types.ObjectId(userId)
                    }
                }
            }
        );

        return TaskAttachment.findById(attachment._id)
            .populate('uploadedBy', 'id name email avatar role')
            .populate('taskId', 'id title taskNumber itemNumber projectId')
            .exec();
    }

    static async getAttachments(taskId: string, companyId: string) {
        const task = await Task.findOne({ _id: taskId, companyId });
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        return TaskAttachment.find({ taskId: task._id, companyId })
            .sort({ createdAt: -1 })
            .populate('uploadedBy', 'id name email avatar role')
            .exec();
    }

    static async deleteAttachment(attachmentId: string, companyId: string) {
        const attachment = await TaskAttachment.findOneAndDelete({ _id: attachmentId, companyId });
        if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');

        await Task.updateOne(
            { _id: attachment.taskId },
            { $pull: { attachments: { fileName: attachment.fileName } } }
        );

        return true;
    }
}
