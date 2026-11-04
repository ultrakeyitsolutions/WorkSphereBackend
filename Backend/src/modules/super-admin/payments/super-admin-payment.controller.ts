import { Response } from 'express';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { catchAsync } from '../../../utils/catchAsync';
import { sendSuccess } from '../../../utils/response';
import { AppError } from '../../../utils/AppError';
import { PaymentService } from '../../payments/services/payment.service';
import { getPaginationParams } from '../shared/pagination.util';
import { PlanUpgradeRequest } from '../subscriptions/plan-upgrade-request.model';
import { Types } from 'mongoose';

const paymentService = new PaymentService();

export class SuperAdminPaymentController {
    /**
     * GET /api/v1/super-admin/payments
     * Global payment history across every company with search, filters, and pagination.
     */
    static getPayments = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const pagination = getPaginationParams(req, 20, 100, 'createdAt', 'desc');

        const filters = {
            companyId: req.query.companyId as string,
            planId: req.query.planId as string,
            status: req.query.status as string,
            dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
            dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
            search: req.query.search as string,
        };

        const result = await paymentService.getGlobalPayments(filters, pagination);

        return sendSuccess(res, 'Global payment transactions retrieved successfully', result);
    });

    /**
     * GET /api/v1/super-admin/payments/export
     * Secure CSV export of payment reports with date range and status filters.
     */
    static exportPayments = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const filters = {
            companyId: req.query.companyId as string,
            planId: req.query.planId as string,
            status: req.query.status as string,
            dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
            dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
            search: req.query.search as string,
        };

        const csvContent = await paymentService.exportPaymentsCSV(filters);

        const filename = `worksphere-payments-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(csvContent);
    });

    /**
     * GET /api/v1/super-admin/payments/:attemptId
     * Detailed payment information including company details, plan snapshot, provider references,
     * failure information, refund information, linked subscription events, and audit logs.
     */
    static getPaymentDetails = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const attemptId = String(req.params.attemptId);
        const details = await paymentService.getPaymentDetails(attemptId);

        return sendSuccess(res, 'Payment transaction details retrieved successfully', details);
    });

    /**
     * GET /api/v1/super-admin/payments/companies/:companyId/overview
     * Company-specific billing overview: current & previous plans, subscription history,
     * payment history, upgrade history, and audit logs.
     */
    static getCompanyOverview = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = String(req.params.companyId);
        const overview = await paymentService.getCompanyBillingOverview(companyId);

        return sendSuccess(res, 'Company billing overview retrieved successfully', overview);
    });

    /**
     * POST /api/v1/super-admin/payments/companies/:companyId/complimentary-upgrade
     * SuperAdmin complimentary or manually granted upgrade.
     * Records actor, company, old plan, new plan, reason, effective time, pricing override.
     * Does not fabricate a fake Razorpay payment and writes an immutable audit event.
     */
    static assignComplimentaryPlan = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = String(req.params.companyId);
        const superAdminId = req.authenticatedUser?.userId || req.user?.userId;

        if (!superAdminId) {
            throw AppError.unauthorized('SuperAdmin identity required');
        }

        const { targetPlanId, reason, pricingOverride, durationMonths } = req.body;

        if (!targetPlanId) {
            throw AppError.badRequest('targetPlanId is required');
        }
        if (!reason || !String(reason).trim()) {
            throw AppError.badRequest('A valid reason is required for granting a complimentary plan change');
        }

        const subscription = await paymentService.assignComplimentaryPlan({
            companyId,
            targetPlanId,
            superAdminId,
            reason: String(reason).trim(),
            pricingOverride: pricingOverride !== undefined ? Number(pricingOverride) : undefined,
            durationMonths: durationMonths ? Number(durationMonths) : undefined,
        });

        return sendSuccess(res, 'Complimentary plan successfully granted and activated', {
            subscriptionId: subscription._id,
            companyId: subscription.companyId,
            planId: subscription.planId,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            isComplimentary: subscription.isComplimentary,
            complimentaryReason: subscription.complimentaryReason,
        });
    });

    /**
     * POST /api/v1/super-admin/payments/companies/:companyId/plan-change
     * SuperAdmin creates a paid plan change / upgrade request for a company.
     */
    static createPlanChange = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const companyId = String(req.params.companyId);
        const superAdminId = req.authenticatedUser?.userId || req.user?.userId;

        if (!superAdminId) {
            throw AppError.unauthorized('SuperAdmin identity required');
        }

        const { targetPlanId, billingCycle, message } = req.body;

        if (!targetPlanId) {
            throw AppError.badRequest('targetPlanId is required');
        }

        const upgradeRequest = await PlanUpgradeRequest.create({
            companyId: new Types.ObjectId(companyId),
            requestedById: new Types.ObjectId(superAdminId),
            targetPlanId: new Types.ObjectId(targetPlanId),
            billingCycle: billingCycle || 'MONTHLY',
            message: message || 'Plan change initiated by SuperAdmin',
            status: 'APPROVED',
            reviewedBy: new Types.ObjectId(superAdminId),
            reviewedAt: new Date(),
        });

        return sendSuccess(res, 'Plan change record created successfully', upgradeRequest, 201);
    });

    /**
     * POST /api/v1/super-admin/payments/:attemptId/refund
     * Executes a refund through Razorpay for a succeeded payment attempt.
     */
    static refundPayment = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
        const attemptId = String(req.params.attemptId);
        const superAdminId = req.authenticatedUser?.userId || req.user?.userId;

        if (!superAdminId) {
            throw AppError.unauthorized('SuperAdmin identity required');
        }

        const { amount, reason } = req.body;
        const amountInMinorUnits = amount ? Math.round(Number(amount) * 100) : undefined;

        const refundedAttempt = await paymentService.refundAttempt({
            attemptId,
            actorId: superAdminId,
            amountInMinorUnits,
            reason: reason || 'SuperAdmin administrative refund',
        });

        return sendSuccess(res, 'Payment successfully refunded', {
            paymentAttemptId: refundedAttempt.attemptId,
            status: refundedAttempt.state,
            refundId: refundedAttempt.refundId,
            refundAmount: refundedAttempt.refundAmount ? (refundedAttempt.refundAmount / 100).toFixed(2) : null,
            refundedAt: refundedAttempt.refundedAt,
        });
    });
}
