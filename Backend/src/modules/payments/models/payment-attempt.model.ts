import { Schema, model } from 'mongoose';
import { IPaymentAttemptDocument, PaymentAttemptState } from './payment-attempt.types';

const paymentAttemptSchema = new Schema<IPaymentAttemptDocument>(
    {
        attemptId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        companyId: {
            type: Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        billingObligationId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        subscriptionId: {
            type: Schema.Types.ObjectId,
            ref: 'Subscription',
            default: null,
        },
        planId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            required: true,
        },
        billingCycle: {
            type: String,
            enum: ['MONTHLY', 'SEMI_ANNUAL', 'YEARLY'],
            required: true,
        },
        isAutoPay: {
            type: Boolean,
            default: false,
        },
        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
        },
        requestFingerprint: {
            type: String,
            required: true,
            trim: true,
        },
        provider: {
            type: String,
            enum: ['RAZORPAY'],
            default: 'RAZORPAY',
            required: true,
        },
        environment: {
            type: String,
            enum: ['test', 'live'],
            default: 'test',
            required: true,
        },
        providerOrderId: {
            type: String,
            default: null,
            trim: true,
        },
        providerPaymentId: {
            type: String,
            default: null,
            trim: true,
        },
        providerSubscriptionId: {
            type: String,
            default: null,
            trim: true,
        },
        providerSignature: {
            type: String,
            default: null,
            select: false, // Security: never expose signature in default queries
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isInteger,
                message: 'Amount must be an integer in minor units (e.g. paise/cents)',
            },
        },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            default: 'INR',
        },
        state: {
            type: String,
            enum: Object.values(PaymentAttemptState),
            default: PaymentAttemptState.INITIATED,
            required: true,
            index: true,
        },
        providerStatus: {
            type: String,
            default: null,
        },
        attemptCount: {
            type: Number,
            default: 1,
            min: 1,
        },
        errorCode: {
            type: String,
            default: null,
        },
        errorMessage: {
            type: String,
            default: null,
        },
        errorSource: {
            type: String,
            default: null,
        },
        errorStep: {
            type: String,
            default: null,
        },
        errorReason: {
            type: String,
            default: null,
        },
        rawResponse: {
            type: Schema.Types.Mixed,
            default: null,
        },
        confirmedAt: {
            type: Date,
            default: null,
        },
        reconciledAt: {
            type: Date,
            default: null,
        },
        nextReconcileAt: {
            type: Date,
            default: null,
            index: true,
        },
        reconciliationCount: {
            type: Number,
            default: 0,
        },
        planSnapshot: {
            type: {
                name: { type: String },
                code: { type: String },
                price: { type: Number },
                currency: { type: String },
                billingCycle: { type: String },
            },
            default: null,
        },
        billingPolicy: {
            type: String,
            enum: ['FULL_PRICE', 'PRORATED', 'COMPLIMENTARY', 'NEXT_CYCLE'],
            default: 'FULL_PRICE',
        },
        refundId: {
            type: String,
            default: null,
            trim: true,
        },
        refundAmount: {
            type: Number,
            default: null,
            min: 0,
        },
        refundReason: {
            type: String,
            default: null,
            trim: true,
        },
        refundedAt: {
            type: Date,
            default: null,
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

// ── Unique Constraints & Indexes ──────────────────────────────────────────────
// 1. Client idempotency key unique per company tenant
paymentAttemptSchema.index(
    { companyId: 1, idempotencyKey: 1 },
    { unique: true }
);

// 2. Provider Payment ID uniqueness (sparse so nulls are allowed before payment happens)
paymentAttemptSchema.index(
    { providerPaymentId: 1 },
    { unique: true, sparse: true }
);

// 3. Provider Order ID uniqueness (sparse)
paymentAttemptSchema.index(
    { providerOrderId: 1 },
    { unique: true, sparse: true }
);

// 4. Billing obligation index for checking active obligations
paymentAttemptSchema.index(
    { companyId: 1, billingObligationId: 1, state: 1 }
);

// 5. Worker polling index for stale/uncertain attempts
paymentAttemptSchema.index(
    { state: 1, nextReconcileAt: 1 }
);

// 6. Chronological company history index
paymentAttemptSchema.index(
    { companyId: 1, createdAt: -1 }
);

// 7. Provider Refund ID index (sparse)
paymentAttemptSchema.index(
    { refundId: 1 },
    { sparse: true }
);

// 8. Global chronological index for SuperAdmin reporting & search
paymentAttemptSchema.index(
    { createdAt: -1 }
);
paymentAttemptSchema.index(
    { state: 1, createdAt: -1 }
);

export const PaymentAttempt = model<IPaymentAttemptDocument>('PaymentAttempt', paymentAttemptSchema);
export default PaymentAttempt;
