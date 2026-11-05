import { Types } from 'mongoose';
import { InvitationDelivery } from './invitation-delivery.model';
import { EmailService } from './email.service';
import { env } from '../../../config/env';

export interface QueuedInvitationEmail {
    deliveryId: Types.ObjectId;
    invitationId: Types.ObjectId;
    email: string;
    rawToken: string;
    companyName: string;
    roleName: string;
    designationName: string;
    companyId: string;
    attempt: number;
    nextRetryAt: Date;
}

export interface QueueStats {
    queued: number;
    processing: number;
    sent: number;
    failed: number;
    maxAttempts: number;
    concurrency: number;
}

/**
 * In-memory background queue for invitation email delivery.
 *
 * Purpose: decouple SMTP (slow, network-bound) from the HTTP invitation
 * response so the API returns immediately after the invitation is durably
 * stored in the database. Emails are delivered asynchronously with bounded
 * concurrency and exponential-backoff retries.
 *
 * Concurrency model: single in-memory queue processed by an interval worker
 * (see invitation-worker.ts). This process owns the queue; multiple worker
 * instances should not run concurrently against the same queue.
 */
export class InvitationEmailQueue {
    private queue: QueuedInvitationEmail[] = [];
    private processingIds = new Set<string>();
    private processing = false;
    private readonly concurrency: number;
    private readonly maxAttempts: number;
    private readonly baseBackoffMs: number;

    // Lifetime counters (reset on process restart — acceptable; delivery
    // records in MongoDB are the source of truth for final status).
    private sentCount = 0;
    private failedCount = 0;

    constructor({
        concurrency = 5,
        maxAttempts = 5,
        baseBackoffMs = 5000,
    }: { concurrency?: number; maxAttempts?: number; baseBackoffMs?: number } = {}) {
        this.concurrency = concurrency;
        this.maxAttempts = maxAttempts;
        this.baseBackoffMs = baseBackoffMs;
    }

    /** Add a delivery to the queue. Idempotent by deliveryId. */
    enqueue(entry: QueuedInvitationEmail): void {
        const already = this.queue.some((q) => q.deliveryId.equals(entry.deliveryId)) ||
            this.processingIds.has(entry.deliveryId.toString());
        if (already) return;
        this.queue.push(entry);
    }

    /** Remove a specific delivery from the pending queue (e.g. on cancel). */
    remove(deliveryId: Types.ObjectId): void {
        const idStr = deliveryId.toString();
        this.queue = this.queue.filter((q) => !q.deliveryId.equals(deliveryId));
        this.processingIds.delete(idStr);
    }

    /** Drain and process all due queue entries with bounded concurrency. */
    async process(): Promise<{ processed: number; sent: number; failed: number }> {
        if (this.processing) {
            return { processed: 0, sent: 0, failed: 0 };
        }
        this.processing = true;
        let processed = 0;
        let sent = 0;
        let failed = 0;

        try {
            const now = new Date();

            // Pick due entries not currently being processed, up to concurrency.
            const due = this.queue
                .filter((q) => !this.processingIds.has(q.deliveryId.toString()))
                .filter((q) => q.nextRetryAt <= now)
                .slice(0, this.concurrency);

            for (const entry of due) {
                this.processingIds.add(entry.deliveryId.toString());
            }

            const results = await Promise.all(due.map((entry) => this.deliverOne(entry)));

            for (const { entry, ok, error } of results) {
                processed++;
                // Remove this entry from the pending queue first. handleFailure re-adds
                // it only when a retry is needed; otherwise the entry stays removed.
                this.queue = this.queue.filter((q) => !q.deliveryId.equals(entry.deliveryId));
                if (ok) {
                    sent++;
                    this.sentCount++;
                } else {
                    failed++;
                    await this.handleFailure(entry, error);
                }
                this.processingIds.delete(entry.deliveryId.toString());
            }
        } finally {
            this.processing = false;
        }

        return { processed, sent, failed };
    }

    getStats(): QueueStats {
        return {
            queued: this.queue.length,
            processing: this.processingIds.size,
            sent: this.sentCount,
            failed: this.failedCount,
            maxAttempts: this.maxAttempts,
            concurrency: this.concurrency,
        };
    }

    /** Expose pending entries for inspection / testing. */
    getPending(): QueuedInvitationEmail[] {
        return [...this.queue];
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private async deliverOne(entry: QueuedInvitationEmail) {
        const start = Date.now();
        try {
            await InvitationDelivery.findByIdAndUpdate(entry.deliveryId, {
                status: 'SENDING',
                $inc: { attemptCount: 1 },
            });

            const result = await EmailService.sendInvitationEmail({
                to: entry.email,
                rawToken: entry.rawToken,
                companyName: entry.companyName,
                roleName: entry.roleName,
                designationName: entry.designationName,
                companyId: entry.companyId,
            });

            await InvitationDelivery.findByIdAndUpdate(entry.deliveryId, {
                status: 'SENT',
                providerMessageId: result.messageId,
                senderEmail: result.senderEmail,
                senderMode: result.senderMode,
                sentAt: new Date(),
            });

            const emailMs = Date.now() - start;
            console.log(JSON.stringify({
                level: 'info',
                component: 'invitation-email-queue',
                event: 'email_sent',
                deliveryId: String(entry.deliveryId),
                invitationId: String(entry.invitationId),
                email: entry.email,
                senderMode: result.senderMode,
                emailMs,
            }));
            return { entry, ok: true, error: null };
        } catch (err: any) {
            const emailMs = Date.now() - start;
            const message = err?.message ?? 'Unknown email error';
            console.error(JSON.stringify({
                level: 'error',
                component: 'invitation-email-queue',
                event: 'email_send_failed',
                deliveryId: String(entry.deliveryId),
                invitationId: String(entry.invitationId),
                email: entry.email,
                attempt: entry.attempt,
                emailMs,
                error: message,
            }));

            await InvitationDelivery.findByIdAndUpdate(entry.deliveryId, {
                status: 'FAILED',
                failureReason: message,
                failedAt: new Date(),
            });

            return { entry, ok: false, error: message };
        }
    }

    private async handleFailure(entry: QueuedInvitationEmail, error: string): Promise<void> {
        const nextAttempt = entry.attempt + 1;
        const backoffMs = this.baseBackoffMs * Math.pow(2, nextAttempt - 1); // 5s, 10s, 20s, 40s, 80s
        const nextRetryAt = new Date(Date.now() + backoffMs);

        if (nextAttempt >= this.maxAttempts) {
            this.failedCount++;
            await InvitationDelivery.findByIdAndUpdate(entry.deliveryId, {
                status: 'FAILED',
                failureReason: error,
                failedAt: new Date(),
            });
            console.error(JSON.stringify({
                level: 'error',
                component: 'invitation-email-queue',
                event: 'email_max_attempts_exceeded',
                deliveryId: String(entry.deliveryId),
                email: entry.email,
                attempts: nextAttempt,
                lastError: error,
            }));
            return;
        }

        // Re-queue for retry with updated attempt/nextRetryAt.
        // (The process loop already removed this entry from the pending queue.)
        this.queue.push({
            ...entry,
            attempt: nextAttempt,
            nextRetryAt,
        });
    }
}

// Singleton shared by the HTTP service (enqueue) and the worker (process).
export const invitationEmailQueue = new InvitationEmailQueue({
    concurrency: Number(env.INVITATION_EMAIL_CONCURRENCY || '5'),
    maxAttempts: Number(env.INVITATION_EMAIL_MAX_ATTEMPTS || '5'),
    baseBackoffMs: Number(env.INVITATION_EMAIL_BASE_BACKOFF_MS || '5000'),
});
