import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { PaymentService } from '../services/payment.service';
import { PaymentAttemptState } from '../models/payment-attempt.types';

const paymentService = new PaymentService();

export class PaymentController {
    /**
     * POST /api/v1/payments/attempts
     * Create or resume an idempotent payment attempt.
     */
    static createAttempt = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const idempotencyKey =
            (req.headers['idempotency-key'] as string) || req.body?.idempotencyKey;

        if (!idempotencyKey || !idempotencyKey.trim()) {
            throw AppError.badRequest(
                'Missing required idempotency key. Provide "Idempotency-Key" header or "idempotencyKey" body parameter.'
            );
        }

        const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
        const companyId = isSuperAdmin && req.body?.companyId ? req.body.companyId : req.currentUser?.companyId;

        if (!companyId) {
            throw AppError.badRequest('Company context is required to initiate a payment attempt');
        }

        const actorId = req.authenticatedUser?.userId || req.currentUser?.userId;
        if (!actorId) {
            throw AppError.unauthorized('Authenticated user context required');
        }

        const result = await paymentService.createPaymentAttempt({
            companyId,
            actorId,
            planId: req.body.planId,
            billingCycle: req.body.billingCycle,
            billingObligationId: req.body.billingObligationId,
            isAutoPay: req.body.isAutoPay,
            idempotencyKey: idempotencyKey.trim(),
            metadata: req.body.metadata,
        });

        const { attempt, isReplay, order } = result;

        if (attempt.state === PaymentAttemptState.UNKNOWN) {
            return res.status(200).json({
                success: true,
                code: 'PAYMENT_STATUS_PENDING',
                message: 'Payment status is being confirmed. Do not pay again.',
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
                : 'Payment attempt created successfully',
            {
                paymentAttemptId: attempt.attemptId,
                status: attempt.state,
                amount: attempt.amount,
                currency: attempt.currency,
                isAutoPay: attempt.isAutoPay,
                billingObligationId: attempt.billingObligationId,
                provider: attempt.provider,
                providerOrderId: attempt.providerOrderId,
                order,
                retryable: attempt.state === PaymentAttemptState.FAILED || attempt.state === PaymentAttemptState.CANCELLED,
            },
            isReplay ? 200 : 201
        );
    });

    /**
     * GET /api/v1/payments/attempts/:attemptId
     * Retrieve status of a payment attempt.
     */
    static getAttempt = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const attemptId = String(req.params.attemptId);
        const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
        const companyId = req.currentUser?.companyId;

        const attempt = await paymentService.getAttemptById(attemptId, companyId, isSuperAdmin);

        return sendSuccess(res, 'Payment attempt retrieved successfully', {
            paymentAttemptId: attempt.attemptId,
            status: attempt.state,
            amount: attempt.amount,
            currency: attempt.currency,
            billingObligationId: attempt.billingObligationId,
            planId: attempt.planId,
            providerOrderId: attempt.providerOrderId,
            providerPaymentId: attempt.providerPaymentId,
            confirmedAt: attempt.confirmedAt,
            errorCode: attempt.errorCode,
            errorMessage: attempt.errorMessage,
            retryable: attempt.state === PaymentAttemptState.FAILED || attempt.state === PaymentAttemptState.CANCELLED,
        });
    });

    /**
     * GET /api/v1/payments/attempts/by-idempotency-key/:key
     * Retrieve attempt by idempotency key.
     */
    static getAttemptByIdempotencyKey = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const key = String(req.params.key);
        const companyId = req.currentUser?.companyId;

        if (!companyId) {
            throw AppError.badRequest('Organization context is required');
        }

        const attempt = await paymentService.getAttemptByIdempotencyKey(key, companyId);

        return sendSuccess(res, 'Payment attempt retrieved successfully', {
            paymentAttemptId: attempt.attemptId,
            status: attempt.state,
            amount: attempt.amount,
            currency: attempt.currency,
            billingObligationId: attempt.billingObligationId,
            providerOrderId: attempt.providerOrderId,
            confirmedAt: attempt.confirmedAt,
            retryable: attempt.state === PaymentAttemptState.FAILED || attempt.state === PaymentAttemptState.CANCELLED,
        });
    });

    /**
     * POST /api/v1/payments/attempts/:attemptId/verify
     * Client callback verification.
     */
    static verifyPayment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const attemptId = String(req.params.attemptId);
        const companyId = req.currentUser?.companyId;

        if (!companyId && req.user?.role !== 'SUPER_ADMIN') {
            throw AppError.badRequest('Organization context is required');
        }

        const updated = await paymentService.verifyPayment(attemptId, companyId || '', {
            providerPaymentId: req.body.providerPaymentId,
            providerOrderId: req.body.providerOrderId,
            providerSignature: req.body.providerSignature,
        });

        return sendSuccess(res, 'Payment verified and confirmed successfully', {
            paymentAttemptId: updated.attemptId,
            status: updated.state,
            confirmedAt: updated.confirmedAt,
            subscriptionId: updated.subscriptionId,
        });
    });

    /**
     * POST /api/v1/payments/attempts/:attemptId/reconcile
     * Explicit reconciliation trigger.
     */
    static reconcileAttempt = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const attemptId = String(req.params.attemptId);
        const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
        const companyId = req.currentUser?.companyId;

        // Verify tenant authorization first
        await paymentService.getAttemptById(attemptId, companyId, isSuperAdmin);

        const reconciled = await paymentService.reconcileAttempt(attemptId);

        return sendSuccess(res, 'Payment attempt reconciled', {
            paymentAttemptId: reconciled.attemptId,
            status: reconciled.state,
            providerStatus: reconciled.providerStatus,
            reconciledAt: reconciled.reconciledAt,
            confirmedAt: reconciled.confirmedAt,
            retryable: reconciled.state === PaymentAttemptState.FAILED || reconciled.state === PaymentAttemptState.CANCELLED,
        });
    });
}
