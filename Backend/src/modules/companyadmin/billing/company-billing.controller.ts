import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { PaymentService } from '../../payments/services/payment.service';
import { getPaginationParams } from '../../super-admin/shared/pagination.util';
import { PlanUpgradeRequest } from '../../super-admin/subscriptions/plan-upgrade-request.model';
import { Plan } from '../../super-admin/plans/plans.model';
import { Notification } from '../../notifications/notification.model';
import { PaymentAttemptState } from '../../payments/models/payment-attempt.types';
import { PaymentOutboxService } from '../../payments/services/payment-outbox.service';
import { Types } from 'mongoose';
import { env } from '../../../config/env';

const paymentService = new PaymentService();

export class CompanyBillingController {
    /**
     * GET /api/v1/company/billing/overview
     * Retrieves current subscription, plan features, renewal information, and available upgrades.
     */
    static getOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        if (!companyId) {
            throw AppError.badRequest('Organization context is required');
        }

        const overview = await paymentService.getTenantBillingOverview(companyId);

        return sendSuccess(res, 'Organization billing overview retrieved successfully', overview);
    });

    /**
     * GET /api/v1/company/billing/payments
     * Retrieves tenant-isolated payment history for the authenticated company only.
     */
    static getPaymentHistory = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        if (!companyId) {
            throw AppError.badRequest('Organization context is required');
        }

        const pagination = getPaginationParams(req, 20, 100, 'createdAt', 'desc');

        const filters = {
            status: req.query.status as string,
            dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
            dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
            search: req.query.search as string,
        };

        const result = await paymentService.getTenantPaymentHistory(companyId, filters, pagination);

        return sendSuccess(res, 'Payment transaction history retrieved successfully', result);
    });

    /**
     * GET /api/v1/company/billing/invoices/:attemptId
     * Retrieves invoice/receipt details for a confirmed transaction belonging to the authenticated company.
     */
    static getInvoice = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        if (!companyId) {
            throw AppError.badRequest('Organization context is required');
        }

        const attemptId = String(req.params.attemptId);
        const invoice = await paymentService.getInvoiceData(attemptId, companyId, false);

        return sendSuccess(res, 'Invoice details retrieved successfully', invoice);
    });

    /**
     * POST /api/v1/company/billing/upgrade
     * Initiates a plan purchase or upgrade flow with server-side Razorpay order creation.
     */
    static initiateUpgrade = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        const actorId = req.currentUser?.userId;

        if (!companyId || !actorId) {
            throw AppError.badRequest('Authenticated user and company context required');
        }

        const idempotencyKey =
            (req.headers['idempotency-key'] as string) || req.body?.idempotencyKey;

        if (!idempotencyKey || !idempotencyKey.trim()) {
            throw AppError.badRequest(
                'Missing required idempotency key. Provide "Idempotency-Key" header or "idempotencyKey" body parameter.'
            );
        }

        const { planId, billingCycle, billingPolicy, isAutoPay, metadata } = req.body;

        if (!planId) {
            throw AppError.badRequest('Target planId is required');
        }

        const normalizedPolicy =
            (billingPolicy === 'STANDARD' ? 'FULL_PRICE' : billingPolicy) || 'PRORATED';

        const result = await paymentService.createPaymentAttempt({
            companyId,
            actorId,
            planId,
            billingCycle,
            billingPolicy: normalizedPolicy as any,
            isAutoPay: Boolean(isAutoPay),
            idempotencyKey: idempotencyKey.trim(),
            metadata,
        });

        const { attempt, isReplay, order } = result;

        if (attempt.state === PaymentAttemptState.UNKNOWN) {
            return res.status(200).json({
                success: true,
                code: 'PAYMENT_STATUS_PENDING',
                message: 'Payment status is currently being confirmed by the bank. Please do not submit again.',
                data: {
                    paymentAttemptId: attempt.attemptId,
                    status: 'UNKNOWN',
                    retryable: false,
                    billingObligationId: attempt.billingObligationId,
                },
            });
        }

        return sendSuccess(
            res,
            isReplay
                ? 'Existing payment attempt returned idempotently'
                : 'Payment checkout initiated successfully',
            {
                paymentAttemptId: attempt.attemptId,
                status: attempt.state,
                amount: attempt.amount,
                formattedAmount: (attempt.amount / 100).toFixed(2),
                currency: attempt.currency,
                isAutoPay: attempt.isAutoPay,
                billingPolicy: attempt.billingPolicy,
                billingObligationId: attempt.billingObligationId,
                provider: attempt.provider,
                providerOrderId: attempt.providerOrderId,
                keyId: env.RAZORPAY_KEY_ID,
                order: order
                    ? {
                          ...order,
                          orderId: order.orderId || attempt.providerOrderId,
                          providerOrderId: order.providerOrderId || attempt.providerOrderId,
                          keyId: env.RAZORPAY_KEY_ID,
                      }
                    : attempt.providerOrderId
                    ? {
                          orderId: attempt.providerOrderId,
                          providerOrderId: attempt.providerOrderId,
                          amount: attempt.amount,
                          currency: attempt.currency,
                          keyId: env.RAZORPAY_KEY_ID,
                      }
                    : undefined,
                retryable: attempt.state === PaymentAttemptState.FAILED || attempt.state === PaymentAttemptState.CANCELLED,
            },
            isReplay ? 200 : 201
        );
    });

    /**
     * POST /api/v1/company/billing/upgrade-requests
     * Submits a formal upgrade or plan modification request for SuperAdmin review.
     */
    static requestUpgrade = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        const requestedById = req.currentUser?.userId;

        if (!companyId || !requestedById) {
            throw AppError.badRequest('Organization context is required');
        }

        const { targetPlanId, billingCycle, message } = req.body;

        if (!targetPlanId) {
            throw AppError.badRequest('targetPlanId is required');
        }

        const targetPlan = await Plan.findById(targetPlanId);
        if (!targetPlan) {
            throw AppError.notFound('Target plan not found');
        }

        const upgradeRequest = await PlanUpgradeRequest.create({
            companyId: new Types.ObjectId(companyId),
            requestedById: new Types.ObjectId(requestedById),
            targetPlanId: new Types.ObjectId(targetPlanId),
            billingCycle: billingCycle || targetPlan.billingCycle,
            message: message ? String(message).trim() : undefined,
            status: 'PENDING',
        });

        // Enqueue durable notification
        await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId,
            deduplicationKey: `notif_upgrade_req_${upgradeRequest._id}`,
            payload: {
                notificationType: 'PLAN_UPGRADE_REQUESTED',
                companyId,
                actorId: requestedById,
                metadata: {
                    planName: targetPlan.name,
                    billingCycle: upgradeRequest.billingCycle,
                },
            },
        });

        return sendSuccess(
            res,
            'Plan upgrade request submitted successfully for administrative review',
            upgradeRequest,
            201
        );
    });

    /**
     * GET /api/v1/company/billing/notifications
     * Retrieves subscription and billing notifications for the company.
     */
    static getNotifications = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = req.currentUser?.companyId;
        if (!companyId) {
            throw AppError.badRequest('Organization context is required');
        }

        const notifications = await Notification.find({
            companyId: new Types.ObjectId(companyId),
            category: 'SUBSCRIPTION',
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return sendSuccess(res, 'Billing notifications retrieved successfully', notifications);
    });
}
