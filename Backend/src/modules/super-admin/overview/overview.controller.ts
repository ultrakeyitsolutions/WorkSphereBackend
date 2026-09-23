import { Request, Response } from 'express';
import { OverviewService } from './overview.service';
import { sendSuccess, sendError } from '../../../utils/response';

export class OverviewController {
    public static async getSummary(req: Request, res: Response): Promise<Response> {
        try {
            const summary = await OverviewService.getSummary();
            return sendSuccess(res, 'Overview summary retrieved successfully', summary);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to retrieve overview summary', 500);
        }
    }
}
