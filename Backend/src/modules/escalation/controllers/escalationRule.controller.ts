import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { EscalationRuleService } from '../services/EscalationRuleService';
import { sendSuccess, sendError } from '../../../utils/response';

export class EscalationRuleController {
    /**
     * GET /api/escalations/rules
     */
    public static async listRules(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            if (!companyId) return sendError(res, 'Company context required', 400);

            const { category, isEnabled } = req.query as any;
            const filter: any = {};
            if (category) filter.category = category;
            if (isEnabled !== undefined) filter.isEnabled = isEnabled === 'true';

            const rules = await EscalationRuleService.listRules(companyId, filter);
            return sendSuccess(res, 'Escalation rules retrieved', rules);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to list rules', 500);
        }
    }

    /**
     * POST /api/escalations/rules
     */
    public static async createRule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            if (!companyId || !userId) return sendError(res, 'Company and user context required', 400);

            const rule = await EscalationRuleService.createRule(companyId, req.body, userId);
            return sendSuccess(res, 'Escalation rule created successfully', rule, 201);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to create rule', error.statusCode || 500);
        }
    }

    /**
     * GET /api/escalations/rules/:id
     */
    public static async getRuleById(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const { id } = req.params as { id: string };

            const rule = await EscalationRuleService.getRuleById(companyId!, id);
            return sendSuccess(res, 'Rule retrieved', rule);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to get rule', error.statusCode || 500);
        }
    }

    /**
     * PUT /api/escalations/rules/:id
     */
    public static async updateRule(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            const { id } = req.params as { id: string };

            const updated = await EscalationRuleService.updateRule(companyId!, id, req.body, userId!);
            return sendSuccess(res, 'Rule updated successfully', updated);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to update rule', error.statusCode || 500);
        }
    }

    /**
     * PATCH /api/escalations/rules/:id/status
     */
    public static async toggleStatus(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.currentUser?.companyId;
            const userId = req.currentUser?.userId;
            const { id } = req.params as { id: string };
            const { isEnabled } = req.body;

            const updated = await EscalationRuleService.toggleRuleStatus(companyId!, id, isEnabled, userId!);
            return sendSuccess(res, `Rule ${isEnabled ? 'enabled' : 'disabled'} successfully`, updated);
        } catch (error: any) {
            return sendError(res, error.message || 'Failed to toggle rule status', error.statusCode || 500);
        }
    }
}
export default EscalationRuleController;
