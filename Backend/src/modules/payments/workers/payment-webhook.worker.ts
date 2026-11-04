import { PaymentWebhookEvent } from '../models/payment-webhook-event.model';
import { PaymentAttempt } from '../models/payment-attempt.model';
import { PaymentAttemptState } from '../models/payment-attempt.types';
import { PaymentService } from '../services/payment.service';
import { PaymentOutboxService } from '../services/payment-outbox.service';
import { SuperAdminNotificationService } from '../../super-admin/notifications/super-admin-notification.service';

export class PaymentWebhookWorker {
    private paymentService: PaymentService;

    constructor(paymentService?: PaymentService) {
        this.paymentService = paymentService || new PaymentService();
    }

    /**
     * Process a single webhook event.
     */
    async processEvent(event: any): Promise<boolean> {
        event.status = 'PROCESSING';
        await event.save();

        try {
            const { eventType, payload } = event;

            // Razorpay webhook payload format:
            // payload.payment?.entity or payload.order?.entity
            const paymentEntity = payload?.payload?.payment?.entity || payload?.payment?.entity;
            const orderEntity = payload?.payload?.order?.entity || payload?.order?.entity;

            const providerPaymentId = paymentEntity?.id;
            const providerOrderId = paymentEntity?.order_id || orderEntity?.id;
            const receipt = orderEntity?.receipt || paymentEntity?.notes?.attemptId;

            // Locate local payment attempt by order ID, receipt, or payment ID
            const query: any = { $or: [] };
            if (providerOrderId) query.$or.push({ providerOrderId });
            if (providerPaymentId) query.$or.push({ providerPaymentId });
            if (receipt) query.$or.push({ attemptId: receipt });

            if (query.$or.length === 0) {
                event.status = 'IGNORED';
                event.processingError = 'No identifiable order or payment reference in webhook payload';
                await event.save();
                return true;
            }

            const attempt = await PaymentAttempt.findOne(query);

            if (!attempt) {
                // If attempt is not yet created locally (out of order webhook), allow retry
                if (event.retryCount < 3) {
                    event.status = 'RECEIVED';
                    event.retryCount += 1;
                    await event.save();
                    return false;
                }
                event.status = 'IGNORED';
                event.processingError = 'Matching local payment attempt not found after retries';
                await event.save();
                return true;
            }

            switch (eventType) {
                case 'payment.captured':
                case 'order.paid': {
                    const webhookAmount = paymentEntity?.amount || orderEntity?.amount_paid;
                    if (typeof webhookAmount === 'number' && webhookAmount !== attempt.amount) {
                        event.status = 'FAILED';
                        event.processingError = `Webhook amount mismatch: expected ${attempt.amount} paise, received ${webhookAmount} paise`;
                        await event.save();
                        return true;
                    }

                    if (attempt.state !== PaymentAttemptState.SUCCEEDED) {
                        await this.paymentService.confirmPaymentSuccess(attempt, {
                            providerPaymentId: providerPaymentId || attempt.providerPaymentId || `pay_${Date.now()}`,
                            providerStatus: paymentEntity?.status || 'captured',
                            raw: paymentEntity || orderEntity,
                        });
                    }
                    break;
                }

                case 'payment.failed': {
                    if (
                        attempt.state !== PaymentAttemptState.SUCCEEDED &&
                        attempt.state !== PaymentAttemptState.REFUNDED
                    ) {
                        attempt.state = PaymentAttemptState.FAILED;
                        attempt.providerPaymentId = providerPaymentId || attempt.providerPaymentId;
                        attempt.errorCode = paymentEntity?.error_code || 'PAYMENT_FAILED';
                        attempt.errorMessage = paymentEntity?.error_description || 'Payment was declined';
                        attempt.errorSource = paymentEntity?.error_source || null;
                        attempt.errorStep = paymentEntity?.error_step || null;
                        attempt.errorReason = paymentEntity?.error_reason || null;
                        await attempt.save();

                        console.warn(
                            `[PaymentWebhookWorker] Payment failed: attemptId=${attempt.attemptId}, orderId=${providerOrderId || attempt.providerOrderId}, paymentId=${providerPaymentId || attempt.providerPaymentId}, errorCode=${attempt.errorCode}, errorDesc=${attempt.errorMessage}, errorSource=${attempt.errorSource}, errorStep=${attempt.errorStep}, errorReason=${attempt.errorReason}`
                        );

                        await PaymentOutboxService.enqueueJob({
                            type: 'PAYMENT_NOTIFICATION',
                            companyId: attempt.companyId,
                            attemptId: attempt.attemptId,
                            deduplicationKey: `notif_wh_failed_${attempt.attemptId}`,
                            payload: {
                                notificationType: 'PAYMENT_FAILED',
                                companyId: attempt.companyId,
                                actorId: attempt.actorId,
                                metadata: {
                                    paymentAttemptId: attempt.attemptId,
                                    amount: (attempt.amount / 100).toFixed(2),
                                    formattedAmount: (attempt.amount / 100).toFixed(2),
                                    currency: attempt.currency,
                                    errorMessage: attempt.errorMessage,
                                    errorSource: attempt.errorSource,
                                    errorStep: attempt.errorStep,
                                    errorReason: attempt.errorReason,
                                },
                            },
                        });

                        // SuperAdmin notification for failed payment webhook
                        SuperAdminNotificationService.dispatch({
                            type: 'PAYMENT_FAILED',
                            companyId: String(attempt.companyId),
                            actorId: String(attempt.actorId),
                            eventId: `sa_wh_fail_${attempt.attemptId}`,
                            metadata: {
                                paymentAttemptId: attempt.attemptId,
                                amount: (attempt.amount / 100).toFixed(2),
                                currency: attempt.currency,
                                errorMessage: attempt.errorMessage,
                            },
                        }).catch(() => {});
                    }
                    break;
                }

                case 'refund.processed': {
                    const refundEntity = payload?.payload?.refund?.entity || payload?.refund?.entity;
                    attempt.state = PaymentAttemptState.REFUNDED;
                    if (refundEntity?.id) attempt.refundId = refundEntity.id;
                    if (refundEntity?.amount) attempt.refundAmount = refundEntity.amount;
                    attempt.refundedAt = new Date();
                    await attempt.save();

                    // Enqueue durable notification for refund
                    await PaymentOutboxService.enqueueJob({
                        type: 'PAYMENT_NOTIFICATION',
                        companyId: attempt.companyId,
                        attemptId: attempt.attemptId,
                        deduplicationKey: `notif_wh_refund_${attempt.attemptId}_${attempt.refundId || Date.now()}`,
                        payload: {
                            notificationType: 'PAYMENT_REFUNDED',
                            companyId: attempt.companyId,
                            actorId: attempt.actorId,
                            metadata: {
                                paymentAttemptId: attempt.attemptId,
                                amount: ((attempt.refundAmount || attempt.amount) / 100).toFixed(2),
                                formattedAmount: ((attempt.refundAmount || attempt.amount) / 100).toFixed(2),
                                currency: attempt.currency,
                                refundId: attempt.refundId,
                            },
                        },
                    });

                    // SuperAdmin notification for refund
                    SuperAdminNotificationService.dispatch({
                        type: 'REFUND_REQUESTED',
                        companyId: String(attempt.companyId),
                        actorId: String(attempt.actorId),
                        eventId: `sa_wh_refund_${attempt.attemptId}_${attempt.refundId || Date.now()}`,
                        metadata: {
                            paymentAttemptId: attempt.attemptId,
                            amount: ((attempt.refundAmount || attempt.amount) / 100).toFixed(2),
                            currency: attempt.currency,
                            refundId: attempt.refundId,
                        },
                    }).catch(() => {});
                    break;
                }

                default:
                    // Other events safely acknowledged
                    break;
            }

            event.status = 'PROCESSED';
            event.processedAt = new Date();
            event.processingError = null;
            await event.save();
            return true;
        } catch (err: any) {
            event.retryCount += 1;
            event.processingError = err.message || String(err);
            event.status = event.retryCount >= 5 ? 'FAILED' : 'RECEIVED';
            await event.save();

            // Dispatch SuperAdmin notification if webhook failed permanently
            if (event.status === 'FAILED') {
                SuperAdminNotificationService.dispatch({
                    type: 'RAZORPAY_WEBHOOK_FAILED',
                    eventId: `sa_wh_failed_${event._id}`,
                    priority: 'CRITICAL',
                    metadata: {
                        webhookEventId: String(event._id),
                        eventType: event.eventType,
                        errorMessage: event.processingError,
                        retryCount: event.retryCount,
                    },
                }).catch(() => {});
            }

            return false;
        }
    }

    /**
     * Batch process pending webhook events.
     */
    async processBatch(limit = 10): Promise<number> {
        const events = await PaymentWebhookEvent.find({
            status: 'RECEIVED',
        })
            .sort({ receivedAt: 1 })
            .limit(limit)
            .exec();

        let processed = 0;
        for (const evt of events) {
            const success = await this.processEvent(evt);
            if (success) processed++;
        }
        return processed;
    }
}
