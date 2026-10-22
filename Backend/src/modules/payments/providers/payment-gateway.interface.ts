export interface CreateOrderParams {
    receipt: string; // Internal attempt ID or reference
    amount: number; // in minor units
    currency: string;
    notes?: Record<string, string>;
    idempotencyKey?: string;
}

export interface GatewayOrderResult {
    providerOrderId: string;
    amount: number;
    currency: string;
    status: string;
    receipt: string;
    raw: Record<string, any>;
}

export interface VerifySignatureParams {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
}

export interface GatewayPaymentResult {
    providerPaymentId: string;
    providerOrderId?: string | null;
    amount: number;
    currency: string;
    status: 'captured' | 'authorized' | 'failed' | 'refunded' | string;
    method?: string;
    errorCode?: string | null;
    errorDescription?: string | null;
    raw: Record<string, any>;
}

export interface RefundParams {
    providerPaymentId: string;
    amount?: number; // minor units (optional for full refund)
    notes?: Record<string, string>;
}

export interface GatewayRefundResult {
    providerRefundId: string;
    providerPaymentId: string;
    amount: number;
    status: string;
    raw: Record<string, any>;
}

export interface CreateSubscriptionParams {
    planId: string;
    totalCount: number;
    quantity?: number;
    customerNotify?: 0 | 1;
    notes?: Record<string, string>;
}

export interface GatewaySubscriptionResult {
    providerSubscriptionId: string;
    planId: string;
    status: string;
    currentStart?: Date;
    currentEnd?: Date;
    raw: Record<string, any>;
}

export interface IPaymentGatewayAdapter {
    readonly providerName: string;
    readonly environment: 'test' | 'live';

    createOrder(params: CreateOrderParams): Promise<GatewayOrderResult>;
    verifyPaymentSignature(params: VerifySignatureParams): boolean;
    verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean;
    fetchPayment(providerPaymentId: string): Promise<GatewayPaymentResult>;
    fetchOrderPayments(providerOrderId: string): Promise<GatewayPaymentResult[]>;
    refundPayment(params: RefundParams): Promise<GatewayRefundResult>;
    createSubscription?(params: CreateSubscriptionParams): Promise<GatewaySubscriptionResult>;
    cancelSubscription?(providerSubscriptionId: string): Promise<boolean>;
}
