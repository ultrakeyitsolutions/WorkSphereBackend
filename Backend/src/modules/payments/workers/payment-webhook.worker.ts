import { PaymentWebhookEvent } from '../models/payment-webhook-event.model';
import { PaymentAttempt } from '../models/payment-attempt.model';
import { PaymentAttemptState } from '../models/payment-attempt.types';
import { PaymentService } from '../services/payment.service';
import { PaymentOutboxService } from '../services/payment-outbox.service';

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
                        await attempt.save();

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
                                },
                            },
                        });
                    }
                    break;
                }

                case 'refund.processed': {
                    attempt.state = PaymentAttemptState.REFUNDED;
                    await attempt.save();
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
