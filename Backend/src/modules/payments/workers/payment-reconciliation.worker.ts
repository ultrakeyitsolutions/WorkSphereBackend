import { PaymentAttempt } from '../models/payment-attempt.model';
import { PaymentAttemptState } from '../models/payment-attempt.types';
import { PaymentService } from '../services/payment.service';

export class PaymentReconciliationWorker {
    private paymentService: PaymentService;
    private isRunning = false;
    private timer?: NodeJS.Timeout;

    constructor(paymentService?: PaymentService) {
        this.paymentService = paymentService || new PaymentService();
    }

    /**
     * Reconcile a single batch of eligible payment attempts.
     */
    async reconcileBatch(batchSize = 25): Promise<{
        processed: number;
        succeeded: number;
        failed: number;
    }> {
        const now = new Date();
        const staleThreshold = new Date(now.getTime() - 2 * 60 * 1000); // at least 2 minutes old

        const eligibleAttempts = await PaymentAttempt.find({
            state: {
                $in: [
                    PaymentAttemptState.PENDING,
                    PaymentAttemptState.UNKNOWN,
                    PaymentAttemptState.RECONCILING,
                ],
            },
            $or: [
                { nextReconcileAt: { $lte: now } },
                {
                    nextReconcileAt: null,
                    createdAt: { $lte: staleThreshold },
                },
            ],
        })
            .sort({ nextReconcileAt: 1 })
            .limit(batchSize)
            .exec();

        let succeeded = 0;
        let failed = 0;

        for (const attempt of eligibleAttempts) {
            try {
                const reconciled = await this.paymentService.reconcileAttempt(attempt.attemptId);
                if (reconciled.state === PaymentAttemptState.SUCCEEDED) {
                    succeeded++;
                } else if (reconciled.state === PaymentAttemptState.FAILED) {
                    failed++;
                }
            } catch (err) {
                // Non-blocking log, next cycle will retry with backoff
                console.error(`[ReconciliationWorker] Error reconciling attempt ${attempt.attemptId}:`, err);
            }
        }

        return {
            processed: eligibleAttempts.length,
            succeeded,
            failed,
        };
    }

    /**
     * Start background recurring worker.
     */
    start(intervalMs = 30000): void {
        if (this.isRunning) return;
        this.isRunning = true;

        const loop = async () => {
            if (!this.isRunning) return;
            try {
                await this.reconcileBatch();
            } catch (err) {
                console.error('[ReconciliationWorker] Polling loop error:', err);
            } finally {
                if (this.isRunning) {
                    this.timer = setTimeout(loop, intervalMs);
                }
            }
        };

        this.timer = setTimeout(loop, 1000);
    }

    /**
     * Stop background worker gracefully.
     */
    stop(): void {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
