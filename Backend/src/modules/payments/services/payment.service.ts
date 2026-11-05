import crypto from 'crypto';
import { Types } from 'mongoose';
import { PaymentAttempt } from '../models/payment-attempt.model';
import { IPaymentAttemptDocument, PaymentAttemptState } from '../models/payment-attempt.types';
import { IPaymentGatewayAdapter } from '../providers/payment-gateway.interface';
import { RazorpayAdapter } from '../providers/razorpay.adapter';
import { PaymentOutboxService } from './payment-outbox.service';
import { Plan } from '../../super-admin/plans/plans.model';
import { Subscription } from '../../super-admin/subscriptions/subscription.model';
import { SubscriptionService } from '../../super-admin/subscriptions/subscription.service';
import { SubscriptionEvent } from '../../super-admin/subscriptions/subscription-event.model';
import { SubscriptionEventType } from '../../super-admin/subscriptions/subscription-event.types';
import { SubscriptionStatus, ISubscriptionDocument } from '../../super-admin/subscriptions/subscription.types';
import { Payment } from '../../super-admin/subscriptions/payment.model';
import { PaymentStatus } from '../../super-admin/subscriptions/payment.types';
import { Company } from '../../super-admin/companies/company.model';
import { EntitlementService } from '../../../services/entitlement.service';
import { CompanyThemeEntitlementService } from '../../companyadmin/settings/company-theme-entitlement.service';
import { CompanyEmailEntitlementService } from '../../companyadmin/settings/company-email-entitlement.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditAction } from '../../audit-logs/audit-log.types';
import { AuditLog } from '../../audit-logs/audit-log.model';
import { PlanUpgradeRequest } from '../../super-admin/subscriptions/plan-upgrade-request.model';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../super-admin/shared/pagination.util';
import { AppError } from '../../../utils/AppError';
import { SubscriptionEntitlementSyncService } from '../../../services/subscription-entitlement-sync.service';
import { SuperAdminNotificationService } from '../../super-admin/notifications/super-admin-notification.service';

export interface CreatePaymentAttemptDTO {
    companyId: string;
    actorId: string;
    planId: string;
    billingCycle?: 'MONTHLY' | 'SEMI_ANNUAL' | 'YEARLY';
    billingPolicy?: 'FULL_PRICE' | 'PRORATED' | 'COMPLIMENTARY' | 'NEXT_CYCLE';
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
        // Normalize billing policy (accept 'STANDARD' as alias for 'FULL_PRICE')
        let billingPolicy = dto.billingPolicy || 'FULL_PRICE';
        if ((billingPolicy as string) === 'STANDARD') {
            billingPolicy = 'FULL_PRICE';
        }

        // Apply SuperAdmin company-level discount if enabled
        const discountEnabled = Boolean(company.billingDiscountEnabled);
        const discountPercentage = Math.max(0, Math.min(100, Number(company.billingDiscountPercentage) || 0));
        let basePrice = plan.price || 0;
        if (discountEnabled && discountPercentage > 0) {
            basePrice = Math.round((basePrice * (1 - discountPercentage / 100)) * 100) / 100;
        }

        let amountInMinorUnits = Math.round(basePrice * 100);

        // Check if SuperAdmin enabled proration for this company (default true)
        const prorationEnabled = company.billingProrationEnabled !== false;

        // Proration calculation: calculate remaining unused credit ONLY from a valid paid active subscription
        if (billingPolicy === 'PRORATED' && prorationEnabled) {
            const activeSub = await SubscriptionService.getActiveSubscriptionDocument(companyId);

            // Only apply proration credit if:
            // 1. Subscription is strictly ACTIVE (not trialing, not paused)
            // 2. Subscription is NOT complimentary
            // 3. Subscription has not expired
            // 4. Subscription had a legitimate non-zero paid base price
            if (
                activeSub &&
                activeSub.status === SubscriptionStatus.ACTIVE &&
                !activeSub.isComplimentary &&
                activeSub.currentPeriodEnd &&
                new Date(activeSub.currentPeriodEnd).getTime() > Date.now()
            ) {
                // If user is renewing the exact same plan, charge full plan price for new cycle
                if (activeSub.planId.toString() === planId) {
                    amountInMinorUnits = Math.round(basePrice * 100);
                } else {
                    const currentPlan = await Plan.findById(activeSub.planId);
                    const effectiveBasePrice =
                        typeof activeSub.pricingOverride === 'number' && activeSub.pricingOverride >= 0
                            ? activeSub.pricingOverride
                            : (currentPlan?.price || 0);

                    if (effectiveBasePrice > 0 && activeSub.currentPeriodStart) {
                        const now = Date.now();
                        const totalPeriodMs =
                            new Date(activeSub.currentPeriodEnd).getTime() - new Date(activeSub.currentPeriodStart).getTime();
                        const remainingMs = Math.max(0, new Date(activeSub.currentPeriodEnd).getTime() - now);

                        if (totalPeriodMs > 0 && remainingMs > 0) {
                            const remainingRatio = Math.min(1, Math.max(0, remainingMs / totalPeriodMs));
                            // Round unused credit to two decimal places (cents)
                            const unusedCredit = Math.round(effectiveBasePrice * remainingRatio * 100) / 100;
                            const netUpgradePrice = Math.max(0, Math.round((basePrice - unusedCredit) * 100) / 100);
                            amountInMinorUnits = Math.round(netUpgradePrice * 100);
                        }
                    }
                }
            }
        }

        // Clamp non-zero amounts below Razorpay's minimum requirement to ₹1.00 (100 paise)
        if (amountInMinorUnits > 0 && amountInMinorUnits < 100) {
            amountInMinorUnits = 100;
        }

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
            if (
                existingAttempt.state === PaymentAttemptState.FAILED ||
                existingAttempt.state === PaymentAttemptState.CANCELLED
            ) {
                // If the previous attempt permanently failed or was cancelled,
                // clean up the failed attempt so a fresh retry can proceed.
                await PaymentAttempt.deleteOne({ _id: existingAttempt._id });
            } else if (existingAttempt.requestFingerprint === requestFingerprint) {
                // Idempotent Replay: return existing attempt
                return {
                    attempt: existingAttempt,
                    isReplay: true,
                    order: existingAttempt.providerOrderId
                        ? {
                              orderId: existingAttempt.providerOrderId,
                              providerOrderId: existingAttempt.providerOrderId,
                              amount: existingAttempt.amount,
                              currency: existingAttempt.currency,
                              status: existingAttempt.providerStatus || 'created',
                              receipt: existingAttempt.attemptId,
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
            // If there is an existing PENDING attempt with an active gateway order:
            if (
                activeObligationAttempt.state === PaymentAttemptState.PENDING &&
                activeObligationAttempt.providerOrderId
            ) {
                // If amount matches, seamlessly resume the pending attempt so customer can complete payment
                if (activeObligationAttempt.amount === amountInMinorUnits) {
                    return {
                        attempt: activeObligationAttempt,
                        isReplay: true,
                        order: {
                            orderId: activeObligationAttempt.providerOrderId,
                            providerOrderId: activeObligationAttempt.providerOrderId,
                            amount: activeObligationAttempt.amount,
                            currency: activeObligationAttempt.currency,
                            status: activeObligationAttempt.providerStatus || 'created',
                            receipt: activeObligationAttempt.attemptId,
                        },
                    };
                } else {
                    // Parameters changed (e.g. proration policy toggled): remove stale pending attempt to free obligation & unique index
                    await PaymentAttempt.deleteOne({ _id: activeObligationAttempt._id });
                }
            } else {
                throw AppError.conflict(
                    'A payment attempt is already in progress for this billing obligation. Please complete or await reconciliation.',
                    'ACTIVE_ATTEMPT_IN_PROGRESS'
                );
            }
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
                billingPolicy,
                isAutoPay: Boolean(dto.isAutoPay),
                idempotencyKey: idempotencyKey.trim(),
                requestFingerprint,
                provider: this.provider.providerName as any,
                environment: this.provider.environment,
                amount: amountInMinorUnits,
                currency,
                planSnapshot: {
                    name: plan.name,
                    code: plan.code,
                    price: plan.price,
                    currency: plan.currency || 'INR',
                    billingCycle: plan.billingCycle,
                },
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
                if (raced && (raced.state === PaymentAttemptState.FAILED || raced.state === PaymentAttemptState.CANCELLED)) {
                    await PaymentAttempt.deleteOne({ _id: raced._id });
                    attempt = await PaymentAttempt.create({
                        attemptId,
                        companyId: new Types.ObjectId(companyId),
                        actorId: new Types.ObjectId(actorId),
                        billingObligationId,
                        planId: new Types.ObjectId(planId),
                        billingCycle,
                        billingPolicy,
                        isAutoPay: Boolean(dto.isAutoPay),
                        idempotencyKey: idempotencyKey.trim(),
                        requestFingerprint,
                        provider: this.provider.providerName as any,
                        environment: this.provider.environment,
                        amount: amountInMinorUnits,
                        currency,
                        planSnapshot: {
                            name: plan.name,
                            code: plan.code,
                            price: plan.price,
                            currency: plan.currency || 'INR',
                            billingCycle: plan.billingCycle,
                        },
                        state: PaymentAttemptState.INITIATED,
                        attemptCount: 1,
                        metadata: dto.metadata || {},
                    });
                } else {
                    throw AppError.conflict('Idempotency conflict on concurrent creation', 'IDEMPOTENCY_CONFLICT');
                }
            } else {
                throw dbErr;
            }
        }

        // 6. Zero-Amount Upgrade (100% covered by proration credit or free plan)
        if (attempt.amount <= 0) {
            attempt.state = PaymentAttemptState.SUCCEEDED;
            attempt.confirmedAt = new Date();
            attempt.providerPaymentId = `zero_charge_${Date.now()}`;
            attempt.providerStatus = 'captured';
            await attempt.save();

            await this.confirmPaymentSuccess(attempt, {
                providerPaymentId: attempt.providerPaymentId,
                providerStatus: 'captured',
                raw: { reason: 'Zero-cost upgrade fully covered by proration credit' },
            });

            return {
                attempt,
                isReplay: false,
            };
        }

        // 7. Provider Call with bounded timeout and uncertain outcome handling
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

            console.log(
                `[PaymentService] Gateway order generated: attemptId=${attempt.attemptId}, providerOrderId=${orderResult.providerOrderId}, amount=${orderResult.amount}, currency=${orderResult.currency}, env=${this.provider.environment}`
            );

            return {
                attempt,
                isReplay: false,
                order: {
                    orderId: orderResult.providerOrderId,
                    providerOrderId: orderResult.providerOrderId,
                    amount: orderResult.amount,
                    currency: orderResult.currency,
                    status: orderResult.status,
                    receipt: attempt.attemptId,
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

            // SuperAdmin Notification for failed payment attempt
            SuperAdminNotificationService.dispatch({
                type: 'PAYMENT_FAILED',
                companyId: String(companyId),
                actorId: String(actorId),
                eventId: `sa_pay_fail_${attempt.attemptId}`,
                metadata: {
                    paymentAttemptId: attempt.attemptId,
                    planName: plan.name,
                    amount: (attempt.amount / 100).toFixed(2),
                    currency: attempt.currency,
                    errorMessage: attempt.errorMessage,
                },
            }).catch(() => {});

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
            attempt.errorSource = 'security';
            attempt.errorStep = 'payment_verification';
            attempt.errorReason = 'signature_mismatch';
            await attempt.save();

            console.error(
                `[PaymentService] Signature verification failed: attemptId=${attemptId}, orderId=${payload.providerOrderId}, paymentId=${payload.providerPaymentId}`
            );

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
        } catch {
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
            attempt.errorSource = paymentDetails.errorSource || null;
            attempt.errorStep = paymentDetails.errorStep || null;
            attempt.errorReason = paymentDetails.errorReason || null;
            await attempt.save();

            console.warn(
                `[PaymentService] Payment verification failed (status=${paymentDetails.status}): attemptId=${attemptId}, orderId=${payload.providerOrderId}, paymentId=${payload.providerPaymentId}, code=${attempt.errorCode}, description=${attempt.errorMessage}, source=${attempt.errorSource}, step=${attempt.errorStep}, reason=${attempt.errorReason}`
            );

            throw AppError.badRequest(`Payment status is ${paymentDetails.status}`);
        }

        // Validate provider amount matches expected attempt amount exactly (paise)
        if (typeof paymentDetails.amount === 'number' && paymentDetails.amount !== attempt.amount) {
            attempt.state = PaymentAttemptState.FAILED;
            attempt.errorCode = 'AMOUNT_MISMATCH';
            attempt.errorMessage = `Payment amount mismatch: gateway received ${paymentDetails.amount} paise, expected ${attempt.amount} paise`;
            attempt.errorSource = 'business';
            attempt.errorStep = 'payment_verification';
            attempt.errorReason = 'amount_mismatch';
            await attempt.save();

            console.warn(
                `[PaymentService] Payment amount mismatch: attemptId=${attemptId}, expected=${attempt.amount}, received=${paymentDetails.amount}`
            );

            throw AppError.badRequest('Payment amount does not match the order amount');
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
            { returnDocument: 'after' }
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

        // SuperAdmin Notifications for payment success and subscription activation
        SuperAdminNotificationService.dispatch({
            type: 'PAYMENT_SUCCESS',
            companyId: String(updated.companyId),
            actorId: String(updated.actorId),
            eventId: `sa_pay_success_${updated.attemptId}`,
            metadata: {
                amount: (updated.amount / 100).toFixed(2),
                currency: updated.currency,
                planName,
                paymentAttemptId: updated.attemptId,
            },
        }).catch(() => {});

        SuperAdminNotificationService.dispatch({
            type: 'SUBSCRIPTION_PURCHASED',
            companyId: String(updated.companyId),
            actorId: String(updated.actorId),
            eventId: `sa_sub_purchased_${updated.attemptId}`,
            metadata: {
                planName,
                billingCycle: updated.billingCycle,
                amount: (updated.amount / 100).toFixed(2),
                currency: updated.currency,
            },
        }).catch(() => {});

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

        // Fetch existing subscription using centralized resolver
        const existingSub = await SubscriptionService.getActiveSubscriptionDocument(attempt.companyId);
        let prevPlanId: any = null;
        let isUpgrade = false;

        if (existingSub && existingSub.status === SubscriptionStatus.ACTIVE && existingSub.currentPeriodEnd > now) {
            // Extend from existing currentPeriodEnd
            periodStart = existingSub.currentPeriodStart;
            periodEnd = new Date(existingSub.currentPeriodEnd);
        }

        // Add duration according to plan billing cycle (supports yearly and annual variants)
        const cycle = ((attempt.billingCycle || plan.billingCycle || '') as string).trim().toUpperCase();
        if (cycle === 'YEARLY' || cycle === 'ANNUAL' || cycle === '1_YEAR') {
            const startYear = periodEnd.getFullYear();
            const startMonth = periodEnd.getMonth();
            const startDay = periodEnd.getDate();
            periodEnd.setFullYear(startYear + 1);
            if (startMonth === 1 && startDay === 29 && periodEnd.getMonth() !== 1) {
                periodEnd.setDate(0);
            }
        } else if (cycle === 'SEMI_ANNUAL' || cycle === '6_MONTHS') {
            periodEnd.setMonth(periodEnd.getMonth() + 6);
        } else if (cycle === 'QUARTERLY' || cycle === '3_MONTHS') {
            periodEnd.setMonth(periodEnd.getMonth() + 3);
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
            isUpgrade = String(existingSub.planId) !== String(attempt.planId);
            prevPlanId = existingSub.planId;

            existingSub.planId = attempt.planId;
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.currentPeriodStart = periodStart;
            existingSub.currentPeriodEnd = periodEnd;
            existingSub.cancelAtPeriodEnd = false;
            existingSub.scheduledPlanId = undefined;
            existingSub.isComplimentary = false;
            existingSub.complimentaryReason = null;
            existingSub.complimentaryGrantedBy = null;
            existingSub.complimentaryGrantedAt = null;
            existingSub.pricingOverride = null;
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

        // Link subscriptionId back to attempt and company
        attempt.subscriptionId = subscriptionDoc._id;
        await attempt.save();
        await Company.updateOne({ _id: attempt.companyId }, { $set: { subscriptionId: subscriptionDoc._id } });

        // Synchronize entitlements, invalidate all caches across workers, log audit, and notify sockets
        await SubscriptionEntitlementSyncService.sync({
            companyId,
            fromPlanId: existingSub ? prevPlanId : null,
            toPlanId: attempt.planId,
            actorId: attempt.actorId,
            action: isUpgrade ? AuditAction.SUBSCRIPTION_UPGRADED : AuditAction.PAYMENT_SUCCEEDED,
            paymentRef: attempt.providerPaymentId || attempt.attemptId,
            effectiveDate: now,
            metadata: {
                attemptId: attempt.attemptId,
                billingObligationId: attempt.billingObligationId,
                billingCycle: attempt.billingCycle,
                amount: attempt.amount,
                currency: attempt.currency,
            },
        });
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
            const createdTime = attempt.createdAt?.getTime ? attempt.createdAt.getTime() : Date.now();
            const isStale = Date.now() - createdTime > 30 * 60 * 1000;
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

    /**
     * SuperAdmin complimentary or manually granted upgrade.
     * Records actor, company, old plan, new plan, reason, effective time, pricing override,
     * without fabricating a fake Razorpay payment, writes an immutable audit event,
     * and invalidates entitlement caches.
     */
    async assignComplimentaryPlan(params: {
        companyId: string;
        targetPlanId: string;
        superAdminId: string;
        reason: string;
        pricingOverride?: number;
        durationMonths?: number;
    }): Promise<ISubscriptionDocument> {
        const { companyId, targetPlanId, superAdminId, reason, pricingOverride, durationMonths } = params;

        if (!reason || !reason.trim()) {
            throw AppError.badRequest('A justification reason is required for granting a complimentary plan');
        }

        const company = await Company.findById(companyId);
        if (!company || company.status === 'DELETED') {
            throw AppError.notFound('Company not found');
        }

        const targetPlan = await Plan.findById(targetPlanId);
        if (!targetPlan || !targetPlan.isActive || targetPlan.isArchived) {
            throw AppError.badRequest('Target plan is invalid or inactive');
        }

        const existingSub = await SubscriptionService.getActiveSubscriptionDocument(companyId);
        const fromPlanId = existingSub?.planId ? (existingSub.planId as Types.ObjectId) : undefined;
        const now = new Date();
        const periodEnd = new Date(now);
        const months = durationMonths && durationMonths > 0 ? durationMonths : (targetPlan.billingCycle === 'YEARLY' ? 12 : 1);
        periodEnd.setMonth(periodEnd.getMonth() + months);

        let subDoc: ISubscriptionDocument;

        if (!existingSub) {
            subDoc = await Subscription.create({
                companyId: new Types.ObjectId(companyId),
                planId: new Types.ObjectId(targetPlanId),
                status: SubscriptionStatus.ACTIVE,
                startedAt: now,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd: false,
                isComplimentary: true,
                complimentaryReason: reason.trim(),
                complimentaryGrantedBy: new Types.ObjectId(superAdminId),
                complimentaryGrantedAt: now,
                pricingOverride: pricingOverride ?? 0,
            });
        } else {
            existingSub.planId = new Types.ObjectId(targetPlanId);
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.currentPeriodStart = now;
            existingSub.currentPeriodEnd = periodEnd;
            existingSub.cancelAtPeriodEnd = false;
            existingSub.scheduledPlanId = undefined;
            existingSub.isComplimentary = true;
            existingSub.complimentaryReason = reason.trim();
            existingSub.complimentaryGrantedBy = new Types.ObjectId(superAdminId);
            existingSub.complimentaryGrantedAt = now;
            existingSub.pricingOverride = pricingOverride ?? 0;
            await existingSub.save();
            subDoc = existingSub;
        }

        await Company.updateOne({ _id: companyId }, { $set: { subscriptionId: subDoc._id } });

        // Immutable Subscription Event
        await SubscriptionEvent.create({
            subscriptionId: subDoc._id,
            companyId: new Types.ObjectId(companyId),
            type: SubscriptionEventType.COMPLIMENTARY_PLAN_GRANTED,
            fromPlanId,
            toPlanId: new Types.ObjectId(targetPlanId),
            fromStatus: existingSub?.status || SubscriptionStatus.ACTIVE,
            toStatus: SubscriptionStatus.ACTIVE,
            effectiveAt: now,
            performedBy: new Types.ObjectId(superAdminId),
            metadata: {
                reason: reason.trim(),
                pricingOverride: pricingOverride ?? 0,
                durationMonths: months,
                periodEnd,
            },
        });

        // Immutable Audit Log
        await AuditLogService.log({
            action: AuditAction.COMPLIMENTARY_PLAN_GRANTED,
            actorId: superAdminId,
            companyId,
            metadata: {
                subscriptionId: subDoc._id,
                fromPlanId,
                toPlanId: targetPlanId,
                targetPlanName: targetPlan.name,
                reason: reason.trim(),
                pricingOverride: pricingOverride ?? 0,
            },
            success: true,
            description: `Complimentary ${targetPlan.name} plan granted to ${company.name} by SuperAdmin (${reason.trim()})`,
        });

        // Invalidate Entitlement Caches
        CompanyThemeEntitlementService.invalidateCache(companyId);
        CompanyEmailEntitlementService.invalidateCache(companyId);
        EntitlementService.invalidateCache(companyId);

        // Enqueue durable notification
        await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId,
            deduplicationKey: `notif_complimentary_${subDoc._id}_${now.getTime()}`,
            payload: {
                notificationType: 'COMPLIMENTARY_PLAN_GRANTED',
                companyId,
                actorId: superAdminId,
                metadata: {
                    companyName: company.name,
                    planName: targetPlan.name,
                    reason: reason.trim(),
                    periodEnd: periodEnd.toLocaleDateString(),
                },
            },
        });

        return subDoc;
    }

    /**
     * SuperAdmin refund execution through Razorpay.
     */
    async refundAttempt(params: {
        attemptId: string;
        actorId: string;
        amountInMinorUnits?: number;
        reason?: string;
    }): Promise<IPaymentAttemptDocument> {
        const { attemptId, actorId, amountInMinorUnits, reason } = params;

        const attempt = await PaymentAttempt.findOne({ attemptId });
        if (!attempt) {
            throw AppError.notFound(`Payment attempt "${attemptId}" not found`);
        }

        if (attempt.state !== PaymentAttemptState.SUCCEEDED) {
            throw AppError.badRequest(`Cannot refund attempt in "${attempt.state}" status. Only SUCCEEDED attempts can be refunded.`);
        }

        if (!attempt.providerPaymentId) {
            throw AppError.badRequest('Payment attempt lacks provider payment ID');
        }

        const refundAmount = amountInMinorUnits || attempt.amount;
        if (refundAmount <= 0 || refundAmount > attempt.amount) {
            throw AppError.badRequest(`Refund amount must be between 1 and ${attempt.amount} minor units`);
        }

        // Call Razorpay refund
        const refundResult = await this.provider.refundPayment({
            providerPaymentId: attempt.providerPaymentId,
            amount: refundAmount,
            notes: {
                attemptId: attempt.attemptId,
                reason: reason || 'SuperAdmin requested refund',
                actorId,
            },
        });

        attempt.state = PaymentAttemptState.REFUNDED;
        attempt.refundId = refundResult.providerRefundId;
        attempt.refundAmount = refundResult.amount;
        attempt.refundReason = reason || 'SuperAdmin refund';
        attempt.refundedAt = new Date();
        await attempt.save();

        // Update legacy payment if exists
        try {
            await Payment.findOneAndUpdate(
                { providerPaymentId: attempt.providerPaymentId },
                { status: PaymentStatus.REFUNDED }
            );
        } catch {
            // Non-blocking
        }

        // Audit log
        AuditLogService.log({
            action: AuditAction.PAYMENT_REFUNDED,
            actorId,
            companyId: String(attempt.companyId),
            metadata: {
                attemptId: attempt.attemptId,
                refundId: refundResult.providerRefundId,
                amount: refundResult.amount,
                reason,
            },
            success: true,
            description: `Payment ${attempt.attemptId} refunded (${attempt.currency} ${refundResult.amount / 100})`,
        });

        // Enqueue durable notification
        const plan = await Plan.findById(attempt.planId);
        await PaymentOutboxService.enqueueJob({
            type: 'PAYMENT_NOTIFICATION',
            companyId: attempt.companyId,
            attemptId: attempt.attemptId,
            deduplicationKey: `notif_refund_${attempt.attemptId}_${refundResult.providerRefundId}`,
            payload: {
                notificationType: 'PAYMENT_REFUNDED',
                companyId: attempt.companyId,
                actorId,
                metadata: {
                    planName: plan?.name || 'Subscription Plan',
                    amount: (refundResult.amount / 100).toFixed(2),
                    formattedAmount: (refundResult.amount / 100).toFixed(2),
                    currency: attempt.currency,
                    refundId: refundResult.providerRefundId,
                    reason: reason || 'Administrative refund',
                },
            },
        });

        return attempt;
    }

    /**
     * SuperAdmin global payment history across all companies with multi-filter search and pagination.
     */
    async getGlobalPayments(
        filters: {
            companyId?: string;
            planId?: string;
            status?: string;
            dateFrom?: string | Date;
            dateTo?: string | Date;
            search?: string;
        },
        pagination: PaginationParams
    ): Promise<PaginatedResult<any>> {
        const query: any = {};

        if (filters.companyId && Types.ObjectId.isValid(filters.companyId)) {
            query.companyId = new Types.ObjectId(filters.companyId);
        }

        if (filters.planId && Types.ObjectId.isValid(filters.planId)) {
            query.planId = new Types.ObjectId(filters.planId);
        }

        if (filters.status) {
            query.state = filters.status.toUpperCase();
        }

        if (filters.dateFrom || filters.dateTo) {
            query.createdAt = {};
            if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
            if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
        }

        if (filters.search && filters.search.trim()) {
            const term = filters.search.trim();
            // Check if search matches company name
            const matchingCompanies = await Company.find({
                name: { $regex: term, $options: 'i' },
            }).select('_id');
            const matchingCompanyIds = matchingCompanies.map((c) => c._id);

            query.$or = [
                { attemptId: { $regex: term, $options: 'i' } },
                { providerOrderId: { $regex: term, $options: 'i' } },
                { providerPaymentId: { $regex: term, $options: 'i' } },
                { billingObligationId: { $regex: term, $options: 'i' } },
                { idempotencyKey: { $regex: term, $options: 'i' } },
                { refundId: { $regex: term, $options: 'i' } },
                ...(matchingCompanyIds.length > 0 ? [{ companyId: { $in: matchingCompanyIds } }] : []),
            ];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [records, total] = await Promise.all([
            PaymentAttempt.find(query)
                .populate('companyId', 'name slug domain email status')
                .populate('planId', 'name price billingCycle currency')
                .populate('actorId', 'name email')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            PaymentAttempt.countDocuments(query),
        ]);

        const items = records.map((rec: any) => ({
            id: rec._id,
            attemptId: rec.attemptId,
            company: rec.companyId
                ? {
                      id: rec.companyId._id,
                      name: rec.companyId.name,
                      slug: rec.companyId.slug,
                      email: rec.companyId.email,
                      status: rec.companyId.status,
                  }
                : null,
            actor: rec.actorId
                ? {
                      id: rec.actorId._id,
                      name: rec.actorId.name,
                      email: rec.actorId.email,
                  }
                : null,
            plan: rec.planSnapshot || (rec.planId
                ? {
                      name: rec.planId.name,
                      price: rec.planId.price,
                      billingCycle: rec.planId.billingCycle,
                      currency: rec.planId.currency,
                  }
                : null),
            billingObligationId: rec.billingObligationId,
            billingCycle: rec.billingCycle,
            billingPolicy: rec.billingPolicy,
            amount: rec.amount,
            formattedAmount: (rec.amount / 100).toFixed(2),
            currency: rec.currency,
            state: rec.state,
            provider: rec.provider,
            environment: rec.environment,
            providerOrderId: rec.providerOrderId,
            providerPaymentId: rec.providerPaymentId,
            providerStatus: rec.providerStatus,
            confirmedAt: rec.confirmedAt,
            reconciledAt: rec.reconciledAt,
            refundId: rec.refundId,
            refundAmount: rec.refundAmount ? (rec.refundAmount / 100).toFixed(2) : null,
            refundReason: rec.refundReason,
            refundedAt: rec.refundedAt,
            errorCode: rec.errorCode,
            errorMessage: rec.errorMessage,
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * SuperAdmin detailed payment information with company, plan, audit trail, and subscription linkage.
     */
    async getPaymentDetails(attemptId: string): Promise<any> {
        const attempt: any = await PaymentAttempt.findOne({ attemptId })
            .populate('companyId', 'name slug domain email status')
            .populate('planId', 'name price billingCycle currency description')
            .populate('actorId', 'name email')
            .populate('subscriptionId')
            .lean();

        if (!attempt) {
            throw AppError.notFound(`Payment attempt "${attemptId}" not found`);
        }

        // Fetch related subscription events
        let subscriptionEvents: any[] = [];
        if (attempt.companyId) {
            subscriptionEvents = await SubscriptionEvent.find({ companyId: attempt.companyId._id })
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('fromPlanId', 'name price')
                .populate('toPlanId', 'name price')
                .populate('performedBy', 'name email')
                .lean();
        }

        // Fetch related audit logs
        const auditLogs = await AuditLog.find({
            companyId: attempt.companyId?._id,
            $or: [
                { 'metadata.attemptId': attempt.attemptId },
                { action: { $in: [AuditAction.PAYMENT_SUCCEEDED, AuditAction.PAYMENT_FAILED, AuditAction.PAYMENT_REFUNDED, AuditAction.PAYMENT_ATTEMPT_CREATED] } },
            ],
        })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('actorId', 'name email')
            .lean();

        return {
            payment: {
                id: attempt._id,
                attemptId: attempt.attemptId,
                company: attempt.companyId,
                actor: attempt.actorId,
                plan: attempt.planSnapshot || attempt.planId,
                subscription: attempt.subscriptionId,
                billingObligationId: attempt.billingObligationId,
                billingCycle: attempt.billingCycle,
                billingPolicy: attempt.billingPolicy,
                isAutoPay: attempt.isAutoPay,
                amount: attempt.amount,
                formattedAmount: (attempt.amount / 100).toFixed(2),
                currency: attempt.currency,
                state: attempt.state,
                provider: attempt.provider,
                environment: attempt.environment,
                providerOrderId: attempt.providerOrderId,
                providerPaymentId: attempt.providerPaymentId,
                providerStatus: attempt.providerStatus,
                confirmedAt: attempt.confirmedAt,
                reconciledAt: attempt.reconciledAt,
                nextReconcileAt: attempt.nextReconcileAt,
                reconciliationCount: attempt.reconciliationCount,
                refundId: attempt.refundId,
                refundAmount: attempt.refundAmount,
                refundReason: attempt.refundReason,
                refundedAt: attempt.refundedAt,
                errorCode: attempt.errorCode,
                errorMessage: attempt.errorMessage,
                metadata: attempt.metadata,
                createdAt: attempt.createdAt,
                updatedAt: attempt.updatedAt,
            },
            subscriptionEvents,
            auditLogs,
        };
    }

    /**
     * Complete company billing overview for SuperAdmin and CompanyAdmin:
     * Current plan, subscription history, payment history, upgrade requests, audit logs.
     */
    async getCompanyBillingOverview(companyId: string): Promise<any> {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid company ID');
        }

        const company = await Company.findById(companyId);
        if (!company || company.status === 'DELETED') {
            throw AppError.notFound('Company not found');
        }

        const activeSubDoc = await SubscriptionService.getActiveSubscriptionDocument(companyId);

        const [subscription, payments, events, upgradeRequests, auditLogs, allPlans] = await Promise.all([
            activeSubDoc
                ? Subscription.findById(activeSubDoc._id)
                      .populate('planId')
                      .populate('scheduledPlanId')
                      .populate('complimentaryGrantedBy', 'name email')
                      .lean()
                : null,
            PaymentAttempt.find({ companyId: new Types.ObjectId(companyId) })
                .populate('planId', 'name price billingCycle')
                .populate('actorId', 'name email')
                .sort({ createdAt: -1 })
                .limit(50)
                .lean(),
            SubscriptionEvent.find({ companyId: new Types.ObjectId(companyId) })
                .populate('fromPlanId', 'name price billingCycle')
                .populate('toPlanId', 'name price billingCycle')
                .populate('performedBy', 'name email')
                .sort({ createdAt: -1 })
                .limit(30)
                .lean(),
            PlanUpgradeRequest.find({ companyId: new Types.ObjectId(companyId) })
                .populate('currentPlanId', 'name price')
                .populate('targetPlanId', 'name price')
                .populate('requestedById', 'name email')
                .populate('reviewedBy', 'name email')
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            AuditLog.find({
                companyId: new Types.ObjectId(companyId),
                action: {
                    $in: [
                        AuditAction.SUBSCRIPTION_CREATED,
                        AuditAction.SUBSCRIPTION_UPGRADED,
                        AuditAction.SUBSCRIPTION_DOWNGRADED,
                        AuditAction.SUBSCRIPTION_PAUSED,
                        AuditAction.SUBSCRIPTION_CANCELLED,
                        AuditAction.COMPLIMENTARY_PLAN_GRANTED,
                        AuditAction.PAYMENT_SUCCEEDED,
                        AuditAction.PAYMENT_FAILED,
                        AuditAction.PAYMENT_REFUNDED,
                    ],
                },
            })
                .sort({ createdAt: -1 })
                .limit(30)
                .lean(),
            Plan.find({ isActive: true, isArchived: false }).lean(),
        ]);

        return {
            company: {
                id: company._id,
                name: company.name,
                slug: company.slug,
                domain: company.domain,
                status: company.status,
                billingDiscountEnabled: Boolean(company.billingDiscountEnabled),
                billingDiscountPercentage: company.billingDiscountPercentage || 0,
                billingProrationEnabled: company.billingProrationEnabled !== false,
            },
            currentPlan: (subscription as any)?.planId || null,
            subscription: subscription
                ? {
                      id: subscription._id,
                      plan: subscription.planId,
                      scheduledPlan: subscription.scheduledPlanId,
                      status: subscription.status,
                      startedAt: subscription.startedAt,
                      currentPeriodStart: subscription.currentPeriodStart,
                      currentPeriodEnd: subscription.currentPeriodEnd,
                      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                      isComplimentary: Boolean(subscription.isComplimentary),
                      complimentaryReason: subscription.complimentaryReason,
                      complimentaryGrantedBy: subscription.complimentaryGrantedBy,
                      complimentaryGrantedAt: subscription.complimentaryGrantedAt,
                      pricingOverride: subscription.pricingOverride,
                      pausedAt: subscription.pausedAt,
                      resumeAt: subscription.resumeAt,
                      pauseReason: subscription.pauseReason,
                      cancellationReason: subscription.cancellationReason,
                  }
                : null,
            availablePlans: allPlans,
            payments: payments.map((p: any) => ({
                id: p._id,
                attemptId: p.attemptId,
                plan: p.planSnapshot || p.planId,
                amount: p.amount,
                formattedAmount: (p.amount / 100).toFixed(2),
                currency: p.currency,
                state: p.state,
                billingPolicy: p.billingPolicy,
                providerOrderId: p.providerOrderId,
                providerPaymentId: p.providerPaymentId,
                confirmedAt: p.confirmedAt,
                refundId: p.refundId,
                refundAmount: p.refundAmount,
                refundedAt: p.refundedAt,
                errorCode: p.errorCode,
                errorMessage: p.errorMessage,
                createdAt: p.createdAt,
            })),
            subscriptionHistory: events,
            upgradeRequests,
            auditLogs,
        };
    }

    /**
     * Tenant-isolated billing overview for CompanyAdmin.
     */
    async getTenantBillingOverview(companyId: string): Promise<any> {
        if (!Types.ObjectId.isValid(companyId)) {
            throw AppError.badRequest('Invalid organization ID');
        }

        const activeSubDoc = await SubscriptionService.getActiveSubscriptionDocument(companyId);

        const [company, subscription, activePlans, recentPayments] = await Promise.all([
            Company.findById(new Types.ObjectId(companyId)).lean(),
            activeSubDoc
                ? Subscription.findById(activeSubDoc._id)
                      .populate('planId')
                      .populate('scheduledPlanId')
                      .lean()
                : null,
            Plan.find({ isActive: true, isArchived: false }).lean(),
            PaymentAttempt.find({ companyId: new Types.ObjectId(companyId) })
                .populate('planId', 'name price billingCycle')
                .sort({ createdAt: -1 })
                .limit(10)
                .lean(),
        ]);

        let currentPlan: any = (subscription as any)?.planId;
        if (!currentPlan) {
            currentPlan = await Plan.findOne({ isDefault: true, isActive: true, isArchived: false }).lean();
        }

        const now = Date.now();

        // Company-level billing discount settings (Super Admin controlled)
        const discountEnabled = Boolean(company?.billingDiscountEnabled);
        const discountPercentage = Math.max(0, Math.min(100, Number(company?.billingDiscountPercentage) || 0));
        const prorationEnabled = company?.billingProrationEnabled !== false; // default true

        // Apply company discount to plan prices if enabled
        const applyDiscount = (price: number) => {
            if (!discountEnabled || discountPercentage <= 0) return price;
            return Math.round((price * (1 - discountPercentage / 100)) * 100) / 100;
        };

        const isEligibleForProration =
            prorationEnabled &&
            subscription &&
            subscription.status === SubscriptionStatus.ACTIVE &&
            !subscription.isComplimentary &&
            subscription.currentPeriodEnd &&
            new Date(subscription.currentPeriodEnd).getTime() > now;

        const effectiveBasePrice = isEligibleForProration
            ? typeof (subscription as any).pricingOverride === 'number' && (subscription as any).pricingOverride >= 0
                ? (subscription as any).pricingOverride
                : (currentPlan?.price || 0)
            : 0;

        const totalPeriodMs =
            isEligibleForProration && subscription.currentPeriodEnd && subscription.currentPeriodStart
                ? new Date(subscription.currentPeriodEnd).getTime() - new Date(subscription.currentPeriodStart).getTime()
                : 0;
        const remainingMs =
            isEligibleForProration && subscription.currentPeriodEnd
                ? Math.max(0, new Date(subscription.currentPeriodEnd).getTime() - now)
                : 0;
        const remainingRatio = totalPeriodMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalPeriodMs)) : 0;

        // A complimentary/free plan (price = 0) generates no proratable credit.
        // You cannot earn credit on a plan you never paid for.
        // If prorationEnabled is false, no proration credit is generated.
        const isPaidPlan = effectiveBasePrice > 0;
        const billableUnusedCredit =
            prorationEnabled && isPaidPlan && isEligibleForProration
                ? Math.round(effectiveBasePrice * remainingRatio * 100) / 100
                : 0;

        const availableUpgrades = activePlans.map((plan: any) => {
            const discountedPrice = applyDiscount(plan.price || 0);
            const isCurrent = currentPlan && String(currentPlan._id) === String(plan._id);
            const proratedPrice = isCurrent
                ? 0
                : Math.max(0, Math.round((discountedPrice - billableUnusedCredit) * 100) / 100);
            return {
                id: plan._id,
                name: plan.name,
                code: plan.code,
                description: plan.description,
                price: plan.price,
                discountedPrice,
                currency: plan.currency,
                billingCycle: plan.billingCycle,
                isCurrent,
                proratedCredit: billableUnusedCredit,
                estimatedPayable: isCurrent ? 0 : proratedPrice,
                proratedUpgradePrice: proratedPrice,
                savingsFromCurrentPlan: billableUnusedCredit,
                discountApplied: discountEnabled && discountPercentage > 0 ? discountPercentage : 0,
                // Net payable after applying prorated credit (never below zero)
                netPayableToday: isCurrent ? 0 : Math.max(0, Math.round((discountedPrice - billableUnusedCredit) * 100) / 100),
            };
        });

        const formattedSub = subscription
            ? {
                  id: String(subscription._id),
                  status: subscription.status,
                  currentPlan,
                  scheduledPlan: subscription.scheduledPlanId,
                  startedAt: subscription.startedAt,
                  currentPeriodStart: subscription.currentPeriodStart,
                  currentPeriodEnd: subscription.currentPeriodEnd,
                  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                  isComplimentary: Boolean(subscription.isComplimentary),
                  complimentaryReason: subscription.isComplimentary ? subscription.complimentaryReason : undefined,
                  pricingOverride: (subscription as any).pricingOverride,
              }
            : null;

        const formattedPlan = currentPlan
            ? {
                  id: String(currentPlan._id),
                  name: currentPlan.name,
                  code: currentPlan.code,
                  description: currentPlan.description,
                  price: currentPlan.price,
                  currency: currentPlan.currency || 'INR',
                  billingCycle: currentPlan.billingCycle,
                  features: currentPlan.features || [],
              }
            : null;

        return {
            company: company
                ? {
                      id: String(company._id),
                      name: company.name,
                      status: company.status,
                  }
                : null,
            currentSubscription: formattedSub,
            currentPlan: formattedPlan,
            subscription: formattedSub,
            availableUpgrades,
            recentPayments: recentPayments.map((p: any) => ({
                id: p._id,
                attemptId: p.attemptId,
                plan: p.planSnapshot || p.planId,
                planName: p.planSnapshot?.name || p.planId?.name || 'Subscription Plan',
                planCode: p.planSnapshot?.code || p.planId?.code || 'PLAN',
                amount: p.amount,
                formattedAmount: (p.amount / 100).toFixed(2),
                currency: p.currency,
                billingCycle: p.billingCycle || p.planSnapshot?.billingCycle || 'MONTHLY',
                billingPolicy: p.billingPolicy || 'FULL_PRICE',
                status: p.state,
                state: p.state,
                providerOrderId: p.providerOrderId,
                providerPaymentId: p.providerPaymentId,
                confirmedAt: p.confirmedAt,
                refundedAt: p.refundedAt,
                safeErrorMessage: p.state === PaymentAttemptState.FAILED ? p.errorMessage : null,
                retryable: p.state === PaymentAttemptState.FAILED || p.state === PaymentAttemptState.CANCELLED,
                createdAt: p.createdAt,
            })),
            companyDiscountSettings: {
                discountEnabled,
                discountPercentage,
                prorationEnabled,
            },
            discountInfo: {
                title: 'What is a Discount / Offer?',
                description: 'A discount or offer is a price reduction applied to your plan. It can be a promotional rate, a loyalty discount, or a superadmin-configured company-level discount.',
                howItWorks: [
                    'Discounts reduce the full plan rate before any proration credit is applied.',
                    'If your company has an active discount, the discounted rate is shown as the Full Plan Rate.',
                    'Prorated credit is then calculated from your current plan’s unused period and subtracted from the discounted rate.',
                    'Net Payable Today = Discounted Full Plan Rate − Prorated Credit (minimum ₹0).',
                ],
                whenItAppears: 'A discount appears when your Super Admin has enabled company-level pricing or when a promotional offer is active for your plan.',
                prorationNote: 'Prorated credit only applies to paid (non-complimentary) plans. If you are on a free plan, there is no unused credit to carry forward.',
            },
            prorationInfo: {
                title: 'What is Prorated Billing?',
                description: 'Proration ensures you only pay for the exact time you use a plan. When upgrading mid-cycle, the unused portion of your current paid subscription is calculated as a credit and deducted from your new plan price.',
                howItWorks: [
                    'We calculate the exact fraction of time remaining in your current billing cycle.',
                    'Remaining Days / Total Period Days × Current Plan Paid Price = Prorated Credit.',
                    'Net Upgrade Payable = New Plan Price (after any discounts) − Prorated Credit.',
                    'If proration is disabled by SuperAdmin, the full new plan price applies without credit deduction.',
                ],
                whenItApplies: 'Applies automatically to all mid-cycle plan upgrades on paid (non-complimentary) active subscriptions.',
                superAdminToggleNotice: prorationEnabled
                    ? 'Proration credit is currently ENABLED for your organization.'
                    : 'Proration credit is currently DISABLED by administrator policy. Full plan rate applies.',
            },
        };
    }

    /**
     * Tenant-isolated payment history for CompanyAdmin.
     */
    async getTenantPaymentHistory(
        companyId: string,
        filters: {
            status?: string;
            dateFrom?: string | Date;
            dateTo?: string | Date;
            search?: string;
        },
        pagination: PaginationParams
    ): Promise<PaginatedResult<any>> {
        const query: any = { companyId: new Types.ObjectId(companyId) };

        if (filters.status) {
            query.state = filters.status.toUpperCase();
        }

        if (filters.dateFrom || filters.dateTo) {
            query.createdAt = {};
            if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
            if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
        }

        if (filters.search && filters.search.trim()) {
            const term = filters.search.trim();
            query.$or = [
                { attemptId: { $regex: term, $options: 'i' } },
                { providerOrderId: { $regex: term, $options: 'i' } },
                { providerPaymentId: { $regex: term, $options: 'i' } },
                { billingObligationId: { $regex: term, $options: 'i' } },
            ];
        }

        const sort: any = {};
        sort[pagination.sortBy] = pagination.sortOrder === 'asc' ? 1 : -1;

        const [records, total] = await Promise.all([
            PaymentAttempt.find(query)
                .populate('planId', 'name price billingCycle currency')
                .sort(sort)
                .skip(pagination.skip)
                .limit(pagination.limit)
                .lean(),
            PaymentAttempt.countDocuments(query),
        ]);

        const items = records.map((rec: any) => ({
            attemptId: rec.attemptId,
            plan: rec.planSnapshot || rec.planId,
            billingCycle: rec.billingCycle,
            amount: rec.amount,
            formattedAmount: (rec.amount / 100).toFixed(2),
            currency: rec.currency,
            state: rec.state,
            provider: rec.provider,
            providerOrderId: rec.providerOrderId,
            providerPaymentId: rec.providerPaymentId,
            confirmedAt: rec.confirmedAt,
            refundId: rec.refundId,
            refundAmount: rec.refundAmount ? (rec.refundAmount / 100).toFixed(2) : null,
            refundedAt: rec.refundedAt,
            errorMessage: rec.state === PaymentAttemptState.FAILED ? rec.errorMessage : null,
            retryable: rec.state === PaymentAttemptState.FAILED || rec.state === PaymentAttemptState.CANCELLED,
            createdAt: rec.createdAt,
        }));

        return {
            items,
            pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
        };
    }

    /**
     * Formatted invoice / receipt data with tenant isolation.
     */
    async getInvoiceData(attemptId: string, companyId?: string, isSuperAdmin = false): Promise<any> {
        const attempt = await this.getAttemptById(attemptId, companyId, isSuperAdmin);

        const company = await Company.findById(attempt.companyId).lean();
        const plan = await Plan.findById(attempt.planId).lean();

        return {
            invoiceNumber: `INV-${attempt.attemptId.replace(/^att_/, '').toUpperCase()}`,
            receiptNumber: attempt.attemptId,
            providerPaymentId: attempt.providerPaymentId,
            providerOrderId: attempt.providerOrderId,
            issueDate: attempt.confirmedAt || attempt.createdAt,
            billingObligationId: attempt.billingObligationId,
            status: attempt.state,
            customer: {
                companyId: attempt.companyId,
                companyName: company?.name || 'Organization',
                domain: company?.domain,
                email: company?.companyEmail || (company as any)?.email,
            },
            lineItems: [
                {
                    description: `Subscription: ${attempt.planSnapshot?.name || plan?.name || 'Plan'} (${attempt.billingCycle})`,
                    billingPolicy: attempt.billingPolicy || 'FULL_PRICE',
                    amount: attempt.amount / 100,
                    currency: attempt.currency,
                },
            ],
            totalAmount: attempt.amount / 100,
            currency: attempt.currency,
            refundDetails: attempt.refundId
                ? {
                      refundId: attempt.refundId,
                      refundAmount: attempt.refundAmount ? attempt.refundAmount / 100 : undefined,
                      refundedAt: attempt.refundedAt,
                      reason: attempt.refundReason,
                  }
                : null,
        };
    }

    /**
     * Export payment reports in CSV format with filtering.
     */
    async exportPaymentsCSV(filters: {
        companyId?: string;
        planId?: string;
        status?: string;
        dateFrom?: string | Date;
        dateTo?: string | Date;
        search?: string;
    }): Promise<string> {
        const result = await this.getGlobalPayments(filters, {
            page: 1,
            limit: 5000,
            skip: 0,
            sortBy: 'createdAt',
            sortOrder: 'desc',
        });

        const header = [
            'Attempt ID',
            'Company Name',
            'Company ID',
            'Plan Name',
            'Billing Cycle',
            'Billing Policy',
            'Amount',
            'Currency',
            'Status',
            'Provider Order ID',
            'Provider Payment ID',
            'Confirmed At',
            'Refund ID',
            'Refund Amount',
            'Refunded At',
            'Error Code',
            'Created At',
        ].join(',');

        const escapeCSV = (val: any) => {
            if (val === null || val === undefined) return '""';
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        };

        const rows = result.items.map((item: any) =>
            [
                escapeCSV(item.attemptId),
                escapeCSV(item.company?.name || ''),
                escapeCSV(item.company?.id || ''),
                escapeCSV(item.plan?.name || ''),
                escapeCSV(item.billingCycle || ''),
                escapeCSV(item.billingPolicy || ''),
                escapeCSV(item.formattedAmount),
                escapeCSV(item.currency),
                escapeCSV(item.state),
                escapeCSV(item.providerOrderId || ''),
                escapeCSV(item.providerPaymentId || ''),
                escapeCSV(item.confirmedAt ? new Date(item.confirmedAt).toISOString() : ''),
                escapeCSV(item.refundId || ''),
                escapeCSV(item.refundAmount || ''),
                escapeCSV(item.refundedAt ? new Date(item.refundedAt).toISOString() : ''),
                escapeCSV(item.errorCode || ''),
                escapeCSV(new Date(item.createdAt).toISOString()),
            ].join(',')
        );

        return [header, ...rows].join('\n');
    }
}
