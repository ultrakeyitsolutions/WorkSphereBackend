import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TaskReactionService } from './task-reaction.service';

export const addReaction = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const activityId = req.params.activityId as string;
        const { reaction } = req.body;

        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!reaction) return res.status(400).json({ success: false, message: 'Reaction is required' });

        const result = await TaskReactionService.addReaction(activityId, userId, companyId as string, reaction);
        return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'ACTIVITY_NOT_FOUND') return res.status(404).json({ success: false, message: 'Activity not found' });
        if (error.message === 'REACTION_ALREADY_EXISTS') return res.status(400).json({ success: false, message: 'Reaction already exists' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const removeReaction = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        const activityId = req.params.activityId as string;
        const reaction = req.params.reaction as string;

        if (!companyId || !userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await TaskReactionService.removeReaction(activityId, userId, companyId as string, reaction);
        return res.status(200).json({ success: true, message: 'Reaction removed' });
    } catch (error: any) {
        if (error.message === 'REACTION_NOT_FOUND') return res.status(404).json({ success: false, message: 'Reaction not found' });
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
