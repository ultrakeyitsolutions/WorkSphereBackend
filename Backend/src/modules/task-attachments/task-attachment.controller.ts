import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TaskAttachmentService } from './task-attachment.service';

export const createAttachment = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const taskId = req.params.taskId as string;

        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const attachment = await TaskAttachmentService.createAttachment(taskId, userId, companyId as string, req.body);
        return res.status(201).json({ success: true, data: attachment });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getAttachments = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const taskId = req.params.taskId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const attachments = await TaskAttachmentService.getAttachments(taskId, companyId as string);
        return res.status(200).json({ success: true, data: attachments });
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Task not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteAttachment = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const attachmentId = req.params.attachmentId as string;

        if (!companyId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskAttachmentService.deleteAttachment(attachmentId, companyId as string);
        return res.status(200).json({ success: true, message: 'Attachment deleted successfully' });
    } catch (error: any) {
        if (error.message === 'ATTACHMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Attachment not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
