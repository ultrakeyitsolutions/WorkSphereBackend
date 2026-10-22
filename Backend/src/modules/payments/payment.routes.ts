import { Router } from 'express';
import { PaymentController } from './controllers/payment.controller';
import { PaymentWebhookController } from './controllers/payment-webhook.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { createPaymentAttemptSchema, verifyPaymentSchema } from './payment.schema';

const router = Router();

// ── Webhook Endpoint (No JWT Auth — Cryptographic Provider Signature Verification) ──
router.post('/webhooks/razorpay', PaymentWebhookController.handleRazorpayWebhook);

// ── Authenticated Payment Attempt Endpoints ────────────────────────────────────
router.use(authenticate);

// POST /api/v1/payments/attempts
router.post(
    '/attempts',
    validateRequest(createPaymentAttemptSchema),
    PaymentController.createAttempt
);

// GET /api/v1/payments/attempts/by-idempotency-key/:key
router.get(
    '/attempts/by-idempotency-key/:key',
    PaymentController.getAttemptByIdempotencyKey
);

// GET /api/v1/payments/attempts/:attemptId
router.get('/attempts/:attemptId', PaymentController.getAttempt);

// POST /api/v1/payments/attempts/:attemptId/verify
router.post(
    '/attempts/:attemptId/verify',
    validateRequest(verifyPaymentSchema),
    PaymentController.verifyPayment
);

// POST /api/v1/payments/attempts/:attemptId/reconcile
router.post(
    '/attempts/:attemptId/reconcile',
    PaymentController.reconcileAttempt
);

export default router;
