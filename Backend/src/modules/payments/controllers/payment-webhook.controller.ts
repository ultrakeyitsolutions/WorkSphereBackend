import { Request, Response } from 'express';
import { catchAsync } from '../../../utils/catchAsync';
import { RazorpayAdapter } from '../providers/razorpay.adapter';
import { PaymentWebhookEvent } from '../models/payment-webhook-event.model';
import { PaymentWebhookWorker } from '../workers/payment-webhook.worker';

const adapter = new RazorpayAdapter();
const webhookWorker = new PaymentWebhookWorker();

export class PaymentWebhookController {
    /**
     * POST /api/v1/payments/webhooks/razorpay
     * Receives, cryptographically verifies, persists, and asynchronously processes webhook events.
     */
    static handleRazorpayWebhook = catchAsync(async (req: Request, res: Response) => {
        const signature = req.headers['x-razorpay-signature'] as string;

        if (!signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing X-Razorpay-Signature header',
            });
        }

        // Retrieve raw body buffer from express.json verify hook
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        const isValid = adapter.verifyWebhookSignature(rawBody, signature);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid webhook signature',
            });
        }

        const payload = req.body;
        const providerEventId =
            payload?.event_id ||
            payload?.id ||
            `wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const eventType = payload?.event || 'unknown';

        let webhookDoc;
        try {
            // Durably persist event before acknowledging
            webhookDoc = await PaymentWebhookEvent.create({
                provider: 'RAZORPAY',
                providerEventId,
                eventType,
                payload,
                status: 'RECEIVED',
                receivedAt: new Date(),
            });
        } catch (dbErr: any) {
            if (dbErr.code === 11000) {
                // Duplicate webhook event — already received and safely acknowledged
                return res.status(200).json({
                    success: true,
                    message: 'Webhook event already recorded (idempotent)',
                    providerEventId,
                });
            }
            throw dbErr;
        }

        // Acknowledge receipt to provider immediately
        res.status(200).json({
            success: true,
            message: 'Webhook received and enqueued for durable processing',
            providerEventId,
        });

        // Trigger asynchronous background worker to process event without holding HTTP connection
        setImmediate(async () => {
            try {
                await webhookWorker.processEvent(webhookDoc);
            } catch (err) {
                console.error(`[PaymentWebhook] Async worker error for event ${providerEventId}:`, err);
            }
        });
    });
}
