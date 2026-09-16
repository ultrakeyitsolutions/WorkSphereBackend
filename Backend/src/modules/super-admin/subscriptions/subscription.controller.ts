import { Request, Response } from 'express';
import { catchAsync } from '../../../utils/catchAsync';
import { SubscriptionService } from './subscription.service';
import { sendSuccess } from '../../../utils/response';
import {
    CreateSubscriptionInput,
    ChangePlanInput,
    PauseSubscriptionInput,
    ResumeSubscriptionInput,
    CancelSubscriptionInput
} from './subscription.schema';

export class SubscriptionController {
    static getSubscription = catchAsync(async (req: Request, res: Response) => {
        const { companyId } = req.params as { companyId: string };
        const result = await SubscriptionService.getCompanySubscription(companyId);

        if (!result) {
            return sendSuccess(res, 'No subscription found for this company', {
                hasSubscription: false,
                subscription: null,
                events: [],
            });
        }

        sendSuccess(res, 'Subscription retrieved successfully', {
            hasSubscription: true,
            ...result,
        });
    });

    static createSubscription = catchAsync(async (req: Request<any, any, CreateSubscriptionInput>, res: Response) => {
        // Here req.params is not typed from the generic Request in express unless we extend it or specify it,
        // let's just cast params to generic Record.
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;

        const { planId, periodStart } = req.body;
        const opts = periodStart ? { periodStart: new Date(periodStart) } : undefined;

        const sub = await SubscriptionService.createSubscription(companyId, planId, adminId, opts);
        sendSuccess(res, 'Subscription created successfully', sub, 201);
    });

    static upgradePlan = catchAsync(async (req: Request<any, any, ChangePlanInput>, res: Response) => {
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;
        const { planId, effectiveImmediate } = req.body;
        const isImmediate = effectiveImmediate !== false;

        const sub = await SubscriptionService.changePlan(companyId, planId, adminId, isImmediate);
        sendSuccess(res, 'Plan upgraded successfully', sub, 200);
    });

    static downgradePlan = catchAsync(async (req: Request<any, any, ChangePlanInput>, res: Response) => {
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;
        const { planId, effectiveImmediate } = req.body;
        const isImmediate = effectiveImmediate !== false;

        const sub = await SubscriptionService.changePlan(companyId, planId, adminId, isImmediate);
        sendSuccess(res, 'Plan downgraded successfully', sub, 200);
    });

    static pauseSubscription = catchAsync(async (req: Request<any, any, PauseSubscriptionInput>, res: Response) => {
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;
        const { pauseFrom, resumeAt, reason } = req.body;

        const pFrom = pauseFrom ? new Date(pauseFrom) : undefined;
        const rAt = resumeAt ? new Date(resumeAt) : undefined;

        const sub = await SubscriptionService.pauseSubscription(companyId, adminId, pFrom, rAt, reason);
        sendSuccess(res, 'Subscription paused successfully', sub, 200);
    });

    static resumeSubscription = catchAsync(async (req: Request<any, any, ResumeSubscriptionInput>, res: Response) => {
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;
        const { resumeImmediate } = req.body;

        const sub = await SubscriptionService.resumeSubscription(companyId, adminId, resumeImmediate);
        sendSuccess(res, 'Subscription resumed successfully', sub, 200);
    });

    static cancelSubscription = catchAsync(async (req: Request<any, any, CancelSubscriptionInput>, res: Response) => {
        const { companyId } = req.params as any;
        const adminId = (req as any).user.userId;
        const { cancelImmediate, reason } = req.body;

        const sub = await SubscriptionService.cancelSubscription(companyId, adminId, cancelImmediate, reason);
        sendSuccess(res, 'Subscription cancelled successfully', sub, 200);
    });
}
