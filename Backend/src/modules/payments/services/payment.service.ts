import crypto from 'crypto';
import { Types } from 'mongoose';
import { PaymentAttempt } from '../models/payment-attempt.model';
import { IPaymentAttemptDocument, PaymentAttemptState } from '../models/payment-attempt.types';
import { IPaymentGatewayAdapter } from '../providers/payment-gateway.interface';
import { RazorpayAdapter } from '../providers/razorpay.adapter';
import { PaymentOutboxService } from './payment-outbox.service';
import { Plan } from '../../super-admin/plans/plans.model';
import { Subscription } from '../../super-admin/subscriptions/subscription.model';
import { SubscriptionEvent } from '../../super-admin/subscriptions/subscription-event.model';
import { SubscriptionEventType } from '../../super-admin/subscriptions/subscription-event.types';
import { SubscriptionStatus } from '../../super-admin/subscriptions/subscription.types';
import { Payment } from '../../super-admin/subscriptions/payment.model';
import { PaymentStatus } from '../../super-admin/subscriptions/payment.types';
import { Company } from '../../super-admin/companies/company.model';
import { EntitlementService } from '../../../services/entitlement.service';
import { CompanyThemeEntitlementService } from '../../companyadmin/settings/company-theme-entitlement.service';
import { CompanyEmailEntitlementService } from '../../companyadmin/settings/company-email-entitlement.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { AppError } from '../../../utils/AppError';

export interface CreatePaymentAttemptDTO {
    companyId: string;
    actorId: string;
    planId: string;
    billingCycle?: 'MONTHLY' | 'SEMI_ANNUAL' | 'YEARLY';
    billingObligationId?: string;
    isAutoPay?: boolean;
    idempotencyKey: string;
    metadata?: Record<string, any>;
}

export class PaymentService {
    private provider: IPaymentGatewayAdapter;

    constructor(provider?: IPaymentGatewayAdapter) {
        this.provider = provider || new RazorpayAdapter();
    }

    /**
     * Compute a canonical SHA-256 fingerprint of the core request parameters.
     */
    static computeRequestFingerprint(params: {
        companyId: string;
        planId: string;
        billingCycle: string;
        amount: number;
        currency: string;
        billingObligationId: string;
    }): string {
        const canonical = JSON.stringify({
            amount: params.amount,
            billingCycle: params.billingCycle,
            billingObligationId: params.billingObligationId,
            companyId: String(params.companyId),
            currency: params.currency.toUpperCase(),
            planId: String(params.planId),
        });
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * Create or retrieve an idempotent payment attempt.
     */
    async createPaymentAttempt(dto: CreatePaymentAttemptDTO): Promise<{
        attempt: IPaymentAttemptDocument;
        isReplay: boolean;
        clientSecret?: string;
        order?: any;
    }> {
        const { companyId, actorId, planId, idempotencyKey } = dto;

        if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
            throw AppError.badRequest('Client idempotency key is required (Idempotency-Key header or idempotencyKey body field)');
        }

        const company = await Company.findById(companyId);
        if (!company || company.status === 'DELETED') {
            throw AppError.notFound('Company not found');
        }

        const plan = await Plan.findById(planId);
        if (!plan) {
            throw AppError.notFound('Plan not found');
        }
        if (!plan.isActive || plan.isArchived) {
            throw AppError.badRequest('Cannot create payment attempt for inactive or archived plan');
        }

        const billingCycle = dto.billingCycle || (plan.billingCycle as any) || 'MONTHLY';
        const amountInMinorUnits = Math.round(plan.price * 100);
        const currency = (plan.currency || 'INR').toUpperCase();

        // 1. Stable Billing Obligation ID
        const dateBucket = new Date().toISOString().slice(0, 7); // e.g. "2026-10"
        const billingObligationId =
            dto.billingObligationId?.trim() ||
            `obl_${companyId}_${planId}_${billingCycle}_${dateBucket}`;

        // 2. Canonical Request Fingerprint
        const requestFingerprint = PaymentService.computeRequestFingerprint({
            companyId,
            planId,
            billingCycle,
            amount: amountInMinorUnits,
            currency,
            billingObligationId,
        });

        // 3. Idempotency Check: Existing key lookup scoped to this company
        const existingAttempt = await PaymentAttempt.findOne({
            companyId: new Types.ObjectId(companyId),
            idempotencyKey: idempotencyKey.trim(),
        });

        if (existingAttempt) {
            if (existingAttempt.requestFingerprint === requestFingerprint) {
                // Idempotent Replay: return existing attempt
                return {
                    attempt: existingAttempt,
                    isReplay: true,
                    order: existingAttempt.providerOrderId
                        ? {
                              orderId: existingAttempt.providerOrderId,
                              amount: existingAttempt.amount,
                              currency: existingAttempt.currency,
                          }
                        : undefined,
                };
            } else {
                // Idempotency Conflict: same key with differing parameters
                throw AppError.conflict(
                    'Idempotency key already used with different parameters (company, plan, amount, or obligation)',
                    'IDEMPOTENCY_CONFLICT'
                );
            }
        }

        // 4. Concurrent Active Obligation Guard:
        // Ensure no other active attempt is currently payable for this obligation
        const activeObligationAttempt = await PaymentAttempt.findOne({
            companyId: new Types.ObjectId(companyId),
            billingObligationId,
            state: {
                $in: [
                    PaymentAttemptState.INITIATED,
                    PaymentAttemptState.PROCESSING,
                    PaymentAttemptState.PENDING,
                    PaymentAttemptState.UNKNOWN,
                    PaymentAttemptState.RECONCILING,
                ],
            },
        });

        if (activeObligationAttempt) {
            throw AppError.conflict(
                'A payment attempt is already in progress for this billing obligation. Please complete or await reconciliation.',
                'ACTIVE_ATTEMPT_IN_PROGRESS'
            );
        }

        // 5. Durable Reservation: create record in INITIATED state
        const attemptId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        let attempt: IPaymentAttemptDocument;

        try {
            attempt = await PaymentAttempt.create({
                attemptId,
                companyId: new Types.ObjectId(companyId),
                actorId: new Types.ObjectId(actorId),
                billingObligationId,
                planId: new Types.ObjectId(planId),
                billingCycle,
                isAutoPay: Boolean(dto.isAutoPay),
                idempotencyKey: idempotencyKey.trim(),
                requestFingerprint,
                provider: this.provider.providerName as any,
                environment: this.provider.environment,
                amount: amountInMinorUnits,
                currency,
                state: PaymentAttemptState.INITIATED,
                attemptCount: 1,
                metadata: dto.metadata || {},
            });
        } catch (dbErr: any) {
            if (dbErr.code === 11000) {
                // Concurrent race won by another process for the same idempotency key
                const raced = await PaymentAttempt.findOne({
                    companyId: new Types.ObjectId(companyId),
                    idempotencyKey: idempotencyKey.trim(),
                });
                if (raced && raced.requestFingerprint === requestFingerprint) {
                    return { attempt: raced, isReplay: true };
                }
                throw AppError.conflict('Idempotency conflict on concurrent creation', 'IDEMPOTENCY_CONFLICT');
            }
            throw dbErr;
        }

        // 6. Provider Call with bounded timeout and uncertain outcome handling
        attempt.state = PaymentAttemptState.PROCESSING;
        await attempt.save();

        try {
            const orderResult = await this.provider.createOrder({
                receipt: attempt.attemptId,
                amount: attempt.amount,
                currency: attempt.currency,
                idempotencyKey: attempt.idempotencyKey,
                notes: {
                    companyId,
                    planId,
                    attemptId: attempt.attemptId,
                    billingObligationId,
                },
            });

            attempt.providerOrderId = orderResult.providerOrderId;
            attempt.providerStatus = orderResult.status;
            attempt.state = PaymentAttemptState.PENDING;
            attempt.rawResponse = orderResult.raw;
            await attempt.save();

            // Audit log creation
            AuditLogService.log({
                action: AuditAction.PAYMENT_ATTEMPT_CREATED,
                actorId,
                companyId,
                metadata: {
                    attemptId: attempt.attemptId,
                    providerOrderId: attempt.providerOrderId,
                    amount: attempt.amount,
                    currency: attempt.currency,
                },
                success: true,
                description: `Payment attempt ${attempt.attemptId} initiated for plan ${plan.name}`,
            });

            return {
                attempt,
                isReplay: false,
                order: {
                    orderId: orderResult.providerOrderId,
                    amount: orderResult.amount,
                    currency: orderResult.currency,
                },
            };
        } catch (gatewayErr: any) {
            const isTimeout = gatewayErr.isTimeout || gatewayErr.code === 'ETIMEDOUT';

            if (isTimeout) {
                // Uncertain outcome: do NOT mark FAILED. Mark UNKNOWN and schedule reconciliation.
                attempt.state = PaymentAttemptState.UNKNOWN;
                attempt.errorCode = 'PROVIDER_TIMEOUT';
                attempt.errorMessage = 'Provider request timed out. Status is being confirmed. Do not pay again.';
                attempt.nextReconcileAt = new Date(Date.now() + 30000);
                await attempt.save();

                // Enqueue verification pending notification
                await PaymentOutboxService.enqueueJob({
                    type: 'PAYMENT_NOTIFICATION',
                    companyId,
                    attemptId: attempt.attemptId,
                    deduplicationKey: `notif_pending_${attempt.attemptId}`,
                    payload: {
                        notificationType: 'PAYMENT_PENDING',
                        companyId,
                        actorId,
                        metadata: {
                            paymentAttemptId: attempt.attemptId,
                            planName: plan.name,
                            amount: (attempt.amount / 100).toFixed(2),
                            formattedAmount: (attempt.amount / 100).toFixed(2),
                            currency: attempt.currency,
                        },
                    },
                });

                return {
                    attempt,
                    isReplay: false,
                };
            }

            // Confirmed failure from provider
            attempt.state = PaymentAttemptState.FAILED;
            attempt.errorCode = gatewayErr.errorCode || 'GATEWAY_ERROR';
            attempt.errorMessage = gatewayErr.message || 'Payment gateway initialization failed';
            await attempt.save();

            // Enqueue payment failure notification
            await PaymentOutboxService.enqueueJob({
                type: 'PAYMENT_NOTIFICATION',
                companyId,
                attemptId: attempt.attemptId,
                deduplicationKey: `notif_failed_${attempt.attemptId}`,
                payload: {
                    notificationType: 'PAYMENT_FAILED',
                    companyId,
                    actorId,
                    metadata: {
                        paymentAttemptId: attempt.attemptId,
                        planName: plan.name,
                        amount: (attempt.amount / 100).toFixed(2),
                        formattedAmount: (attempt.amount / 100).toFixed(2),
                        currency: attempt.currency,
                        errorMessage: attempt.errorMessage,
                    },
                },
            });

            throw AppError.badRequest(`Payment order creation failed: ${gatewayErr.message}`);
        }
    }

    /**
     * Retrieve payment attempt with tenant isolation.
     */
    async getAttemptById(
        attemptId: string,
        companyId?: string,
        isSuperAdmin = false
    ): Promise<IPaymentAttemptDocument> {
        const attempt = await PaymentAttempt.findOne({ attemptId }).populate('planId', 'name price billingCycle');
        if (!attempt) {
            throw AppError.notFound(`Payment attempt "${attemptId}" not found`);
        }

        if (!isSuperAdmin && companyId && String(attempt.companyId) !== String(companyId)) {
            throw AppError.forbidden('Access to payment attempt belonging to another organization is denied');
        }

        return attempt;
    }

    /**
     * Retrieve payment attempt by idempotency key with tenant isolation.
     */
    async getAttemptByIdempotencyKey(
        key: string,
        companyId: string
    ): Promise<IPaymentAttemptDocument> {
        const attempt = await PaymentAttempt.findOne({
            companyId: new Types.ObjectId(companyId),
            idempotencyKey: key.trim(),
        }).populate('planId', 'name price billingCycle');

        if (!attempt) {
            throw AppError.notFound(`No payment attempt found for idempotency key "${key}"`);
        }

        return attempt;
    }

    /**
     * Verify payment response from client callback or synchronous confirmation.
     */
    async verifyPayment(
        attemptId: string,
        companyId: string,
        payload: {
            providerPaymentId: string;
            providerOrderId: string;
            providerSignature: string;
        }
    ): Promise<IPaymentAttemptDocument> {
        const attempt = await this.getAttemptById(attemptId, companyId);

        // 1. Idempotent check: if already SUCCEEDED, return immediately
        if (attempt.state === PaymentAttemptState.SUCCEEDED) {
            return attempt;
        }

        // 2. Reject terminal non-successful states
        if (attempt.state === PaymentAttemptState.FAILED || attempt.state === PaymentAttemptState.CANCELLED) {
            throw AppError.badRequest(`Cannot verify payment for attempt in state ${attempt.state}`);
        }

        // 3. Cryptographic Signature Verification
        const isSignatureValid = this.provider.verifyPaymentSignature({
            providerOrderId: payload.providerOrderId,
            providerPaymentId: payload.providerPaymentId,
            signature: payload.providerSignature,
        });

        if (!isSignatureValid) {
            attempt.state = PaymentAttemptState.FAILED;
            attempt.errorCode = 'INVALID_SIGNATURE';
            attempt.errorMessage = 'Payment signature verification failed';
            await attempt.save();

            AuditLogService.log({
                action: AuditAction.PAYMENT_FAILED,
                actorId: String(attempt.actorId),
                companyId: String(attempt.companyId),
                metadata: { attemptId, reason: 'INVALID_SIGNATURE' },
                success: false,
                description: `Payment verification failed for attempt ${attemptId}: Invalid signature`,
            });

            throw AppError.badRequest('Invalid payment signature verification failed');
        }

        // 4. Provider-side status verification
        let paymentDetails: any;
        try {
            paymentDetails = await this.provider.fetchPayment(payload.providerPaymentId);
        } catch (fetchErr: any) {
            // If provider fetch fails after signature, mark UNKNOWN and reconcile
            attempt.state = PaymentAttemptState.UNKNOWN;
            attempt.providerPaymentId = payload.providerPaymentId;
            attempt.nextReconcileAt = new Date(Date.now() + 30000);
            await attempt.save();
            return attempt;
        }

        const isCaptured =
            paymentDetails.status === 'captured' || paymentDetails.status === 'authorized';

        if (!isCaptured) {
            attempt.state = PaymentAttemptState.FAILED;
            attempt.providerPaymentId = payload.providerPaymentId;
            attempt.providerStatus = paymentDetails.status;
            attempt.errorCode = paymentDetails.errorCode || 'PAYMENT_NOT_CAPTURED';
            attempt.errorMessage = paymentDetails.errorDescription || 'Payment was not captured';
            await attempt.save();
            throw AppError.badRequest(`Payment status is ${paymentDetails.status}`);
        }

        // 5. Atomic transition to SUCCEEDED
        return await this.confirmPaymentSuccess(attempt, {
            providerPaymentId: payload.providerPaymentId,
            providerStatus: paymentDetails.status,
            raw: paymentDetails.raw,
        });
    }

    /**
     * Atomic transition to SUCCEEDED with durable subscription activation and notifications.
     */
    async confirmPaymentSuccess(
        attempt: IPaymentAttemptDocument,
        details: {
            providerPaymentId: string;
            providerStatus: string;
            raw?: Record<string, any>;
        }
    ): Promise<IPaymentAttemptDocument> {
        // Atomic conditional update to prevent double activation
        const updated = await PaymentAttempt.findOneAndUpdate(
            {
                attemptId: attempt.attemptId,
                state: {
                    $in: [
                        PaymentAttemptState.INITIATED,
                        PaymentAttemptState.PROCESSING,
                        PaymentAttemptState.PENDING,
                        PaymentAttemptState.UNKNOWN,
                        PaymentAttemptState.RECONCILING,
                    ],
                },
            },
            {
                $set: {
                    state: PaymentAttemptState.SUCCEEDED,
                    providerPaymentId: details.providerPaymentId,
                    providerStatus: details.providerStatus,
                    confirmedAt: new Date(),
                    reconciledAt: new Date(),
                    rawResponse: details.raw || attempt.rawResponse,
                    errorCode: null,
                    errorMessage: null,
                },
            },
            { new: true }
        );

        if (!updated) {
            // Already succeeded or moved to a terminal state
            return (await PaymentAttempt.findOne({ attemptId: attempt.attemptId }))!;
        }

        // 1. Idempotently Activate Subscription
        await this.activateSubscriptionForPayment(updated);

        // 2. Sync to legacy Payment model for backwards compatibility with reporting
        try {
            await Payment.create({
                companyId: updated.companyId,
                subscriptionId: updated.subscriptionId || updated.companyId,
                amount: updated.amount / 100,
                currency: updated.currency,
                status: PaymentStatus.SUCCESS,
                paymentMethod: 'ONLINE',
                provider: updated.provider,
                providerPaymentId: updated.providerPaymentId || undefined,
                paidAt: updated.confirmedAt || undefined,
            });
        } catch {
            // Non-blocking fallback
        }

        // 3. Enqueue durable notification outbox jobs
        const plan = await Plan.findById(updated.planId);
        const planName = plan?.name || 'Selected Plan';

        await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId: updated.companyId,
            attemptId: updated.attemptId,
            deduplicationKey: `notif_success_${updated.attemptId}`,
            payload: {
                notificationType: 'PAYMENT_SUCCESS',
                companyId: updated.companyId,
                actorId: updated.actorId,
                metadata: {
                    paymentAttemptId: updated.attemptId,
                    planName,
                    amount: (updated.amount / 100).toFixed(2),
                    formattedAmount: (updated.amount / 100).toFixed(2),
                    currency: updated.currency,
                    billingObligationId: updated.billingObligationId,
                },
            },
        });

        await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId: updated.companyId,
            attemptId: updated.attemptId,
            deduplicationKey: `notif_sub_active_${updated.attemptId}`,
            payload: {
                notificationType: 'SUBSCRIPTION_ACTIVATED',
                companyId: updated.companyId,
                actorId: updated.actorId,
                metadata: {
                    companyName: 'Your Organization',
                    planName,
                    billingCycle: updated.billingCycle,
                    periodEnd: new Date().toLocaleDateString(),
                },
            },
        });

        // 4. Audit Log
        AuditLogService.log({
            action: AuditAction.PAYMENT_SUCCEEDED,
            actorId: String(updated.actorId),
            companyId: String(updated.companyId),
            metadata: {
                attemptId: updated.attemptId,
                providerPaymentId: updated.providerPaymentId,
                amount: updated.amount,
                currency: updated.currency,
            },
            success: true,
            description: `Payment succeeded for attempt ${updated.attemptId} (${updated.currency} ${updated.amount / 100})`,
        });

        return updated;
    }

    /**
     * Idempotently activate or renew the company subscription upon confirmed payment.
     */
    async activateSubscriptionForPayment(attempt: IPaymentAttemptDocument): Promise<void> {
        const companyId = attempt.companyId.toString();
        const plan = await Plan.findById(attempt.planId);
        if (!plan) return;

        const now = new Date();
        let periodStart = now;
        let periodEnd = new Date(now);

        // Fetch existing subscription
        const existingSub = await Subscription.findOne({ companyId: attempt.companyId });

        if (existingSub && existingSub.status === SubscriptionStatus.ACTIVE && existingSub.currentPeriodEnd > now) {
            // Extend from existing currentPeriodEnd
            periodStart = existingSub.currentPeriodStart;
            periodEnd = new Date(existingSub.currentPeriodEnd);
        }

        // Add duration according to plan billing cycle
        if (attempt.billingCycle === 'YEARLY' || plan.billingCycle === 'YEARLY') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else if (attempt.billingCycle === 'SEMI_ANNUAL' || plan.billingCycle === 'SEMI_ANNUAL') {
            periodEnd.setMonth(periodEnd.getMonth() + 6);
        } else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        let subscriptionDoc;
        if (!existingSub) {
            subscriptionDoc = await Subscription.create({
                companyId: attempt.companyId,
                planId: attempt.planId,
                status: SubscriptionStatus.ACTIVE,
                startedAt: now,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd: false,
            });

            await SubscriptionEvent.create({
                subscriptionId: subscriptionDoc._id,
                companyId: attempt.companyId,
                type: SubscriptionEventType.SUBSCRIPTION_CREATED,
                toPlanId: attempt.planId,
                toStatus: SubscriptionStatus.ACTIVE,
                effectiveAt: now,
                performedBy: attempt.actorId,
                metadata: {
                    attemptId: attempt.attemptId,
                    billingObligationId: attempt.billingObligationId,
                },
            });
        } else {
            const isUpgrade = String(existingSub.planId) !== String(attempt.planId);
            const prevPlanId = existingSub.planId;

            existingSub.planId = attempt.planId;
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.currentPeriodStart = periodStart;
            existingSub.currentPeriodEnd = periodEnd;
            existingSub.cancelAtPeriodEnd = false;
            existingSub.scheduledPlanId = undefined;
            await existingSub.save();
            subscriptionDoc = existingSub;

            await SubscriptionEvent.create({
                subscriptionId: existingSub._id,
                companyId: attempt.companyId,
                type: isUpgrade ? SubscriptionEventType.PLAN_UPGRADED : SubscriptionEventType.PLAN_RENEWED,
                fromPlanId: prevPlanId,
                toPlanId: attempt.planId,
                fromStatus: existingSub.status,
                toStatus: SubscriptionStatus.ACTIVE,
                effectiveAt: now,
                performedBy: attempt.actorId,
                metadata: {
                    attemptId: attempt.attemptId,
                    billingObligationId: attempt.billingObligationId,
                },
            });
        }

        // Link subscriptionId back to attempt
        attempt.subscriptionId = subscriptionDoc._id;
        await attempt.save();

        // Invalidate all entitlement caches across instances
        CompanyThemeEntitlementService.invalidateCache(companyId);
        CompanyEmailEntitlementService.invalidateCache(companyId);
        EntitlementService.invalidateCache(companyId);
    }

    /**
     * Reconcile an unknown or pending payment attempt against the gateway provider.
     */
    async reconcileAttempt(attemptId: string): Promise<IPaymentAttemptDocument> {
        const attempt = await PaymentAttempt.findOne({ attemptId });
        if (!attempt) {
            throw AppError.notFound(`Payment attempt "${attemptId}" not found for reconciliation`);
        }

        if (
            attempt.state === PaymentAttemptState.SUCCEEDED ||
            attempt.state === PaymentAttemptState.REFUNDED
        ) {
            return attempt;
        }

        attempt.state = PaymentAttemptState.RECONCILING;
        attempt.reconciliationCount += 1;
        await attempt.save();

        try {
            let capturedPayment: any = null;

            // 1. If we have a providerPaymentId, query it directly
            if (attempt.providerPaymentId) {
                const payment = await this.provider.fetchPayment(attempt.providerPaymentId);
                if (payment.status === 'captured' || payment.status === 'authorized') {
                    capturedPayment = payment;
                }
            }

            // 2. If not found or no paymentId, query all payments for the order
            if (!capturedPayment && attempt.providerOrderId) {
                const payments = await this.provider.fetchOrderPayments(attempt.providerOrderId);
                capturedPayment = payments.find(
                    (p) => p.status === 'captured' || p.status === 'authorized'
                );
            }

            if (capturedPayment) {
                return await this.confirmPaymentSuccess(attempt, {
                    providerPaymentId: capturedPayment.providerPaymentId,
                    providerStatus: capturedPayment.status,
                    raw: capturedPayment.raw,
                });
            }

            // If no payment succeeded and attempt is stale (> 30 mins old)
            const isStale = Date.now() - attempt.createdAt.getTime() > 30 * 60 * 1000;
            if (isStale) {
                attempt.state = PaymentAttemptState.FAILED;
                attempt.errorCode = 'PAYMENT_EXPIRED';
                attempt.errorMessage = 'Payment window expired without confirmation';
                attempt.reconciledAt = new Date();
                attempt.nextReconcileAt = null;
                await attempt.save();
                return attempt;
            }

            // Otherwise, keep in UNKNOWN with backoff
            attempt.state = PaymentAttemptState.UNKNOWN;
            attempt.reconciledAt = new Date();
            const backoffMinutes = Math.min(60, Math.pow(2, attempt.reconciliationCount));
            attempt.nextReconcileAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
            await attempt.save();
            return attempt;
        } catch (err: any) {
            attempt.state = PaymentAttemptState.UNKNOWN;
            attempt.errorMessage = `Reconciliation error: ${err.message}`;
            attempt.nextReconcileAt = new Date(Date.now() + 5 * 60 * 1000);
            await attempt.save();
            return attempt;
        }
    }
}
