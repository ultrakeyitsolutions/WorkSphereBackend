import crypto from 'crypto';
import {
    IPaymentGatewayAdapter,
    CreateOrderParams,
    GatewayOrderResult,
    VerifySignatureParams,
    GatewayPaymentResult,
    RefundParams,
    GatewayRefundResult,
    CreateSubscriptionParams,
    GatewaySubscriptionResult,
} from './payment-gateway.interface';
import { env } from '../../../config/env';

export interface RazorpayAdapterConfig {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    timeoutMs?: number;
    baseUrl?: string;
}

export class RazorpayAdapter implements IPaymentGatewayAdapter {
    readonly providerName = 'RAZORPAY';
    private keyId: string;
    private keySecret: string;
    private webhookSecret: string;
    private timeoutMs: number;
    private baseUrl: string;

    constructor(config?: RazorpayAdapterConfig) {
        this.keyId = config?.keyId ?? env.RAZORPAY_KEY_ID;
        this.keySecret = config?.keySecret ?? env.RAZORPAY_KEY_SECRET;
        this.webhookSecret = config?.webhookSecret ?? env.RAZORPAY_WEBHOOK_SECRET;
        this.timeoutMs = config?.timeoutMs ?? 8000;
        this.baseUrl = (config?.baseUrl ?? 'https://api.razorpay.com/v1').replace(/\/$/, '');
    }

    get environment(): 'test' | 'live' {
        return this.keyId.startsWith('rzp_live') ? 'live' : 'test';
    }

    private getAuthHeader(): string {
        const credentials = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Bounded HTTP request with timeout, AbortController, and sanitized error reporting.
     */
    private async request<T = any>(
        path: string,
        options: {
            method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
            body?: any;
            headers?: Record<string, string>;
        }
    ): Promise<T> {
        if (!this.keyId || !this.keySecret) {
            throw new Error('Razorpay credentials not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
        const headers: Record<string, string> = {
            Authorization: this.getAuthHeader(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {}),
        };

        try {
            const response = await fetch(url, {
                method: options.method,
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });

            const data: any = await response.json().catch(() => ({}));

            if (!response.ok) {
                const errorDescription =
                    data?.error?.description || data?.error?.message || response.statusText;
                const errorCode = data?.error?.code || `HTTP_${response.status}`;
                const err: any = new Error(`Razorpay API error [${errorCode}]: ${errorDescription}`);
                err.statusCode = response.status;
                err.errorCode = errorCode;
                err.details = data;
                throw err;
            }

            return data as T;
        } catch (error: any) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                const timeoutErr: any = new Error(
                    `Razorpay request timed out after ${this.timeoutMs}ms for ${options.method} ${path}`
                );
                timeoutErr.code = 'ETIMEDOUT';
                timeoutErr.isTimeout = true;
                throw timeoutErr;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Creates an Order with Razorpay.
     */
    async createOrder(params: CreateOrderParams): Promise<GatewayOrderResult> {
        const headers: Record<string, string> = {};
        if (params.idempotencyKey) {
            headers['X-Razorpay-Idempotency-Key'] = params.idempotencyKey;
        }

        const payload = {
            amount: params.amount,
            currency: params.currency.toUpperCase(),
            receipt: params.receipt,
            notes: params.notes,
        };

        const res = await this.request('/orders', {
            method: 'POST',
            body: payload,
            headers,
        });

        return {
            providerOrderId: res.id,
            amount: res.amount,
            currency: res.currency,
            status: res.status,
            receipt: res.receipt,
            raw: {
                id: res.id,
                entity: res.entity,
                amount: res.amount,
                status: res.status,
                created_at: res.created_at,
            },
        };
    }

    /**
     * Verifies payment signature returned by the client-side Razorpay SDK callback.
     * signature = hmac_sha256(order_id + "|" + payment_id, key_secret)
     */
    verifyPaymentSignature(params: VerifySignatureParams): boolean {
        if (!params.providerOrderId || !params.providerPaymentId || !params.signature) {
            return false;
        }

        try {
            const body = `${params.providerOrderId}|${params.providerPaymentId}`;
            const expectedSignature = crypto
                .createHmac('sha256', this.keySecret)
                .update(body)
                .digest('hex');

            const sigBuf = Buffer.from(params.signature, 'utf8');
            const expBuf = Buffer.from(expectedSignature, 'utf8');

            if (sigBuf.length !== expBuf.length) {
                return false;
            }

            return crypto.timingSafeEqual(sigBuf, expBuf);
        } catch {
            return false;
        }
    }

    /**
     * Verifies Razorpay Webhook signature against raw request body.
     */
    verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
        const secret = this.webhookSecret;
        if (!secret || !signature) {
            return false;
        }

        try {
            const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
            const expected = crypto
                .createHmac('sha256', secret)
                .update(bodyStr)
                .digest('hex');

            const sigBuf = Buffer.from(signature, 'utf8');
            const expBuf = Buffer.from(expected, 'utf8');

            if (sigBuf.length !== expBuf.length) {
                return false;
            }

            return crypto.timingSafeEqual(sigBuf, expBuf);
        } catch {
            return false;
        }
    }

    /**
     * Fetches details of a specific payment by payment ID.
     */
    async fetchPayment(providerPaymentId: string): Promise<GatewayPaymentResult> {
        const res = await this.request(`/payments/${encodeURIComponent(providerPaymentId)}`, {
            method: 'GET',
        });

        return {
            providerPaymentId: res.id,
            providerOrderId: res.order_id || null,
            amount: res.amount,
            currency: res.currency,
            status: res.status,
            method: res.method,
            errorCode: res.error_code || null,
            errorDescription: res.error_description || null,
            raw: {
                id: res.id,
                status: res.status,
                order_id: res.order_id,
                method: res.method,
                captured: res.captured,
                email: res.email ? '[REDACTED]' : undefined,
                contact: res.contact ? '[REDACTED]' : undefined,
            },
        };
    }

    /**
     * Fetches all payments associated with an order.
     */
    async fetchOrderPayments(providerOrderId: string): Promise<GatewayPaymentResult[]> {
        const res = await this.request(`/orders/${encodeURIComponent(providerOrderId)}/payments`, {
            method: 'GET',
        });

        const items: any[] = Array.isArray(res.items) ? res.items : [];
        return items.map((p) => ({
            providerPaymentId: p.id,
            providerOrderId: p.order_id || providerOrderId,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            method: p.method,
            errorCode: p.error_code || null,
            errorDescription: p.error_description || null,
            raw: {
                id: p.id,
                status: p.status,
                captured: p.captured,
            },
        }));
    }

    /**
     * Refunds a captured payment.
     */
    async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
        const payload: any = {};
        if (params.amount !== undefined) {
            payload.amount = params.amount;
        }
        if (params.notes) {
            payload.notes = params.notes;
        }

        const res = await this.request(
            `/payments/${encodeURIComponent(params.providerPaymentId)}/refund`,
            {
                method: 'POST',
                body: payload,
            }
        );

        return {
            providerRefundId: res.id,
            providerPaymentId: res.payment_id,
            amount: res.amount,
            status: res.status,
            raw: {
                id: res.id,
                status: res.status,
                amount: res.amount,
            },
        };
    }

    /**
     * AutoPay / Subscription mandate creation.
     */
    async createSubscription(params: CreateSubscriptionParams): Promise<GatewaySubscriptionResult> {
        const payload = {
            plan_id: params.planId,
            total_count: params.totalCount,
            quantity: params.quantity || 1,
            customer_notify: params.customerNotify !== undefined ? params.customerNotify : 1,
            notes: params.notes,
        };

        const res = await this.request('/subscriptions', {
            method: 'POST',
            body: payload,
        });

        return {
            providerSubscriptionId: res.id,
            planId: res.plan_id,
            status: res.status,
            currentStart: res.current_start ? new Date(res.current_start * 1000) : undefined,
            currentEnd: res.current_end ? new Date(res.current_end * 1000) : undefined,
            raw: {
                id: res.id,
                status: res.status,
            },
        };
    }

    /**
     * Cancels an active AutoPay / Subscription mandate.
     */
    async cancelSubscription(providerSubscriptionId: string): Promise<boolean> {
        try {
            await this.request(
                `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
                {
                    method: 'POST',
                    body: { cancel_at_cycle_end: 0 },
                }
            );
            return true;
        } catch (err: any) {
            if (err.statusCode === 404 || err.errorCode === 'BAD_REQUEST_ERROR') {
                return false;
            }
            throw err;
        }
    }
}
