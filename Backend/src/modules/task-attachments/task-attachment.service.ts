import { Types } from 'mongoose';
import { TaskAttachment, AttachmentType } from './task-attachment.model';
import { Task } from '../tasks/task.model';

export class TaskAttachmentService {
    private static async findTask(taskId: string, companyId: string) {
        if (Types.ObjectId.isValid(taskId)) {
            const task = await Task.findOne({ _id: taskId, companyId });
            if (task) return task;
        }

        const num = Number(taskId);
        return Task.findOne({
            companyId,
            $or: [
                ...(isNaN(num) ? [] : [{ itemNumber: num }]),
                { taskNumber: taskId },
                { ticketId: taskId }
            ]
        });
    }

    public static formatAttachment(att: any) {
        if (!att) return null;
        const doc = att.toObject ? att.toObject({ virtuals: true }) : att;
        const uploadedByDoc = doc.uploadedBy;
        let uploadedByFormatted: any = null;

        if (uploadedByDoc && typeof uploadedByDoc === 'object') {
            uploadedByFormatted = {
                id: uploadedByDoc._id ? uploadedByDoc._id.toString() : (uploadedByDoc.id || null),
                fullName: uploadedByDoc.name || uploadedByDoc.fullName || '',
                name: uploadedByDoc.name || uploadedByDoc.fullName || '',
                email: uploadedByDoc.email || '',
                avatar: uploadedByDoc.avatar || null,
                role: uploadedByDoc.role || null
            };
        }

        const isVoiceNote =
            doc.fileType === 'voice-note' ||
            doc.type === AttachmentType.VOICE_NOTE ||
            (doc.fileName && String(doc.fileName).toLowerCase().startsWith('voice-note')) ||
            (doc.contentType && String(doc.contentType).toLowerCase().startsWith('audio/'));

        const resolvedFileType = doc.fileType || (isVoiceNote ? 'voice-note' : doc.type === AttachmentType.IMAGE ? 'image' : 'document');
        const resolvedContentType = doc.contentType || doc.mimeType || (isVoiceNote ? 'audio/webm' : 'application/octet-stream');
        const uploaderId = doc.uploadedById
            ? doc.uploadedById.toString()
            : (uploadedByFormatted?.id || (doc.uploadedBy ? (doc.uploadedBy._id ? doc.uploadedBy._id.toString() : doc.uploadedBy.toString()) : null));

        const rawTaskId = doc.taskId;
        const taskIdStr = rawTaskId ? (rawTaskId._id ? rawTaskId._id.toString() : rawTaskId.toString()) : null;

        return {
            id: doc._id ? doc._id.toString() : (doc.id || ''),
            _id: doc._id,
            taskId: taskIdStr,
            fileName: doc.fileName,
            filePath: doc.filePath || doc.url || '',
            url: doc.url || doc.filePath || '',
            fileType: resolvedFileType,
            fileSize: doc.fileSize ?? doc.size ?? 0,
            contentType: resolvedContentType,
            mimeType: resolvedContentType,
            type: doc.type,
            duration: doc.duration ?? null,
            uploadedById: uploaderId,
            uploadedBy: uploadedByFormatted || uploaderId,
            uploadedAt: doc.uploadedAt || doc.createdAt,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            youtubeVideoId: doc.youtubeVideoId ?? null,
            isInherited: Boolean(doc.isInherited),
            sourceTaskId: doc.sourceTaskId ? doc.sourceTaskId.toString() : taskIdStr
        };
    }

    static async createAttachment(taskId: string, userId: string, companyId: string, data: any) {
        const task = await this.findTask(taskId, companyId);
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const filePath = data.filePath || data.url || '';
        const url = data.url || data.filePath || '';
        const storageKey = data.storageKey || filePath || data.fileName;
        const originalName = data.originalName || data.fileName;
        const size = data.fileSize ?? data.size ?? 0;
        const mimeType = data.contentType || data.mimeType || (data.fileType === 'voice-note' ? 'audio/webm' : 'application/octet-stream');

        const upperType = String(data.type || data.fileType || '').toUpperCase().replace(/-/g, '_');
        const isVoiceNote =
            data.fileType === 'voice-note' ||
            upperType === 'VOICE_NOTE' ||
            (data.fileName && String(data.fileName).toLowerCase().startsWith('voice-note')) ||
            (mimeType && String(mimeType).toLowerCase().startsWith('audio/'));

        let type: AttachmentType = AttachmentType.OTHER;
        if (isVoiceNote) {
            type = AttachmentType.VOICE_NOTE;
        } else if (['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'VOICE_NOTE', 'OTHER'].includes(upperType)) {
            type = upperType as AttachmentType;
        } else {
            type = AttachmentType.DOCUMENT;
        }

        const fileType = data.fileType || (isVoiceNote ? 'voice-note' : type === AttachmentType.IMAGE ? 'image' : 'document');
        const userObjId = new Types.ObjectId(userId);

        const attachment = new TaskAttachment({
            companyId: new Types.ObjectId(companyId),
            projectId: task.projectId,
            taskId: task._id,
            uploadedBy: userObjId,
            uploadedById: userObjId,
            fileName: data.fileName,
            originalName,
            storageKey,
            url,
            filePath,
            fileType,
            fileSize: size,
            contentType: mimeType,
            mimeType,
            size,
            duration: data.duration ?? null,
            type,
            youtubeVideoId: data.youtubeVideoId || null,
            isInherited: Boolean(data.isInherited),
            sourceTaskId: data.sourceTaskId && Types.ObjectId.isValid(data.sourceTaskId) ? new Types.ObjectId(data.sourceTaskId) : task._id,
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
                        fileType,
                        fileSize: size,
                        uploadedById: userObjId
                    }
                }
            }
        );

        const created = await TaskAttachment.findById(attachment._id)
            .populate('uploadedBy', 'id name email avatar role')
            .populate('taskId', 'id title taskNumber itemNumber projectId')
            .exec();

        return this.formatAttachment(created);
    }

    static async getAttachments(taskId: string, companyId: string) {
        const task = await this.findTask(taskId, companyId);
        if (!task) {
            throw new Error('TASK_NOT_FOUND');
        }

        const attachments = await TaskAttachment.find({
            $or: [
                { taskId: task._id },
                { sourceTaskId: task._id }
            ],
            companyId
        })
            .sort({ createdAt: -1 })
            .populate('uploadedBy', 'id name email avatar role')
            .exec();

        return attachments.map(att => this.formatAttachment(att));
    }

    static async deleteAttachment(attachmentId: string, companyId: string, userId?: string, role?: string) {
        let attachment = null;
        if (Types.ObjectId.isValid(attachmentId)) {
            attachment = await TaskAttachment.findOne({ _id: attachmentId, companyId });
        }
        if (!attachment) {
            attachment = await TaskAttachment.findOne({
                companyId,
                $or: [
                    { fileName: attachmentId },
                    { storageKey: attachmentId }
                ]
            });
        }
        if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');

        await TaskAttachment.deleteOne({ _id: attachment._id });

        await Task.updateOne(
            { _id: attachment.taskId },
            { $pull: { attachments: { fileName: attachment.fileName } } }
        );

        return true;
    }
}
