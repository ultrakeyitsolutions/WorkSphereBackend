import { Document, Types } from 'mongoose';

export enum PaymentAttemptState {
    INITIATED = 'INITIATED',
    PROCESSING = 'PROCESSING',
    PENDING = 'PENDING',
    UNKNOWN = 'UNKNOWN',
    RECONCILING = 'RECONCILING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED',
}

export type PaymentProvider = 'RAZORPAY';

export type PaymentEnvironment = 'test' | 'live';

export interface IPaymentAttempt {
    /** Unique business internal attempt identifier (e.g. att_xxx) */
    attemptId: string;

    /** Tenant isolation */
    companyId: Types.ObjectId;

    /** Authenticated actor who initiated the checkout/charge */
    actorId: Types.ObjectId;

    /** Unique billing cycle/invoice obligation ID preventing duplicate charges for the same billing window */
    billingObligationId: string;

    /** Subscription reference if existing */
    subscriptionId?: Types.ObjectId | null;

    /** Target Plan reference */
    planId: Types.ObjectId;

    /** Billing cycle (e.g., MONTHLY, YEARLY) */
    billingCycle: 'MONTHLY' | 'SEMI_ANNUAL' | 'YEARLY';

    /** Whether AutoPay / recurring mandate is enabled for this attempt */
    isAutoPay: boolean;

    /** Client-supplied idempotency key (header or body) */
    idempotencyKey: string;

    /** SHA-256 fingerprint of canonical request payload */
    requestFingerprint: string;

    /** Payment Gateway provider */
    provider: PaymentProvider;

    /** Gateway environment */
    environment: PaymentEnvironment;

    /** Provider order reference (e.g., order_xxxx) */
    providerOrderId?: string | null;

    /** Provider payment reference (e.g., pay_xxxx) */
    providerPaymentId?: string | null;

    /** Provider subscription / mandate ID for AutoPay (e.g., sub_xxxx) */
    providerSubscriptionId?: string | null;

    /** Provider signature for verification */
    providerSignature?: string | null;

    /** Amount in minor units (e.g., paise for INR, cents for USD). Always an integer. */
    amount: number;

    /** ISO 4217 Currency code (e.g., INR) */
    currency: string;

    /** Payment state machine status */
    state: PaymentAttemptState;

    /** Provider returned status (e.g. created, authorized, captured, failed) */
    providerStatus?: string | null;

    /** Number of payment/network attempts */
    attemptCount: number;

    /** Safe error code for client/auditing */
    errorCode?: string | null;

    /** Safe error message */
    errorMessage?: string | null;

    /** Sanitized provider raw response/metadata (never credentials/secrets) */
    rawResponse?: Record<string, any> | null;

    /** Payment confirmed / captured timestamp */
    confirmedAt?: Date | null;

    /** Last reconciliation check timestamp */
    reconciledAt?: Date | null;

    /** Scheduled time for background reconciliation worker */
    nextReconcileAt?: Date | null;

    /** Reconciliation attempt count */
    reconciliationCount: number;

    /** Additional business context */
    metadata?: Record<string, any>;
}

export interface IPaymentAttemptDocument extends IPaymentAttempt, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
