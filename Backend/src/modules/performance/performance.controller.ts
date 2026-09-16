import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types';
import { PerformanceService } from './performance.service';

/**
 * GET /api/v1/company/users/:userId/performance
 * Returns high-level performance overview summary metrics.
 */
export const getPerformanceSummary = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const targetUserId = req.params.userId as string;
        const query = req.query as any;

        const summary = await PerformanceService.getPerformanceSummary(req.user, targetUserId, query);

        return res.status(200).json({
            success: true,
            data: summary,
        });
    } catch (err: any) {
        const status = err.statusCode || (err.message?.includes('Forbidden') ? 403 : err.message?.includes('not found') ? 404 : 500);
        return res.status(status).json({
            success: false,
            message: err.message || 'Failed to fetch performance summary',
        });
    }
};

/**
 * GET /api/v1/company/users/:userId/performance/timeline
 * Returns paginated chronological event timeline.
 */
export const getPerformanceTimeline = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const targetUserId = req.params.userId as string;
        const query = req.query as any;

        const timeline = await PerformanceService.getTimeline(req.user, targetUserId, query);

        return res.status(200).json({
            success: true,
            data: timeline,
        });
    } catch (err: any) {
        const status = err.statusCode || (err.message?.includes('Forbidden') ? 403 : 500);
        return res.status(status).json({
            success: false,
            message: err.message || 'Failed to fetch performance timeline',
        });
    }
};

/**
 * GET /api/v1/company/users/:userId/performance/tasks
 * Returns paginated task breakdown list.
 */
export const getPerformanceTasks = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const targetUserId = req.params.userId as string;
        const query = req.query as any;

        const tasksResult = await PerformanceService.getTasks(req.user, targetUserId, query);

        return res.status(200).json({
            success: true,
            data: tasksResult,
        });
    } catch (err: any) {
        const status = err.statusCode || (err.message?.includes('Forbidden') ? 403 : 500);
        return res.status(status).json({
            success: false,
            message: err.message || 'Failed to fetch performance task breakdown',
        });
    }
};

/**
 * GET /api/v1/company/users/:userId/performance/meetings
 * Returns paginated meeting breakdown list.
 */
export const getPerformanceMeetings = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const targetUserId = req.params.userId as string;
        const query = req.query as any;

        const meetingsResult = await PerformanceService.getMeetings(req.user, targetUserId, query);

        return res.status(200).json({
            success: true,
            data: meetingsResult,
        });
    } catch (err: any) {
        const status = err.statusCode || (err.message?.includes('Forbidden') ? 403 : 500);
        return res.status(status).json({
            success: false,
            message: err.message || 'Failed to fetch performance meeting breakdown',
        });
    }
};

/**
 * GET /api/v1/company/users/:userId/performance/daily
 * Returns day-by-day trend metrics.
 */
export const getPerformanceDaily = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const targetUserId = req.params.userId as string;
        const query = req.query as any;

        const dailyResult = await PerformanceService.getDailyTrends(req.user, targetUserId, query);

        return res.status(200).json({
            success: true,
            data: dailyResult,
        });
    } catch (err: any) {
        const status = err.statusCode || (err.message?.includes('Forbidden') ? 403 : 500);
        return res.status(status).json({
            success: false,
            message: err.message || 'Failed to fetch performance daily trends',
        });
    }
};
