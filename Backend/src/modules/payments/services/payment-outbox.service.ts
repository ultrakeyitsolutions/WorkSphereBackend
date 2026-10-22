import { Types } from 'mongoose';
import { PaymentOutboxJob, OutboxJobType } from '../models/payment-outbox.model';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationType } from '../../notifications/notification.types';

export class PaymentOutboxService {
    private static notificationService = new NotificationService();

    /**
     * Enqueue a durable job into the outbox with deduplication guarantee.
     */
    static async enqueueJob(params: {
        type: OutboxJobType;
        companyId: string | Types.ObjectId;
        attemptId?: string;
        deduplicationKey: string;
        payload: Record<string, any>;
        delayMs?: number;
    }) {
        const nextRunAt = new Date(Date.now() + (params.delayMs || 0));
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        try {
            return await PaymentOutboxJob.findOneAndUpdate(
                { deduplicationKey: params.deduplicationKey },
                {
                    $setOnInsert: {
                        jobId,
                        type: params.type,
                        companyId: new Types.ObjectId(params.companyId),
                        attemptId: params.attemptId || null,
                        deduplicationKey: params.deduplicationKey,
                        payload: params.payload,
                        status: 'PENDING',
                        attempts: 0,
                        maxAttempts: 5,
                        nextRunAt,
                    },
                },
                { upsert: true, new: true }
            );
        } catch (err: any) {
            if (err.code === 11000) {
                return await PaymentOutboxJob.findOne({ deduplicationKey: params.deduplicationKey });
            }
            throw err;
        }
    }

    /**
     * Process a single outbox job safely with retries and dead-letter queue.
     */
    static async processJob(job: any): Promise<boolean> {
        try {
            if (job.type === 'PAYMENT_NOTIFICATION') {
                const { notificationType, companyId, actorId, metadata, recipientIds, actionUrl } = job.payload;
                await this.notificationService.publish({
                    type: notificationType as NotificationType,
                    companyId: String(companyId),
                    actorId: String(actorId),
                    eventId: job.deduplicationKey,
                    metadata,
                    recipientIds,
                    actionUrl,
                });
            }

            job.status = 'COMPLETED';
            job.completedAt = new Date();
            job.lastError = null;
            await job.save();
            return true;
        } catch (err: any) {
            job.attempts += 1;
            job.lastError = err.message || String(err);

            if (job.attempts >= job.maxAttempts) {
                job.status = 'DEAD_LETTER';
            } else {
                job.status = 'FAILED';
                // Exponential backoff with jitter: 2s, 8s, 32s, 128s...
                const backoffMs = Math.pow(4, job.attempts) * 1000 + Math.floor(Math.random() * 1000);
                job.nextRunAt = new Date(Date.now() + backoffMs);
            }

            await job.save();
            return false;
        }
    }

    /**
     * Poll and process pending outbox jobs in batches.
     */
    static async processPendingBatch(batchSize = 20): Promise<number> {
        const now = new Date();
        const lockId = `worker_${process.pid}_${Date.now()}`;

        // Find and lock jobs atomically
        const jobs = await PaymentOutboxJob.find({
            status: { $in: ['PENDING', 'FAILED'] },
            nextRunAt: { $lte: now },
            $or: [
                { lockedAt: null },
                { lockedAt: { $lte: new Date(now.getTime() - 60000) } }, // 1 min lock expiration
            ],
        })
            .limit(batchSize)
            .exec();

        let processedCount = 0;
        for (const job of jobs) {
            job.lockedAt = new Date();
            job.lockedBy = lockId;
            job.status = 'PROCESSING';
            await job.save();

            const success = await this.processJob(job);
            if (success) processedCount++;
        }

        return processedCount;
    }
}
