import { invitationEmailQueue } from './invitation-queue.service';

let invitationWorkerInterval: NodeJS.Timeout | null = null;

/**
 * Background worker that processes the invitation email queue.
 *
 * Runs on an interval (default 5s), draining QUEUED deliveries and retrying
 * failed ones with exponential backoff. This decouples slow SMTP delivery
 * from the HTTP invitation response.
 *
 * Follows the same interval-scheduler convention as MeetingSchedulerJob.
 */
export class InvitationEmailWorker {
    public static async processTick(): Promise<void> {
        try {
            const result = await invitationEmailQueue.process();
            if (result.processed > 0) {
                console.log(JSON.stringify({
                    level: 'info',
                    component: 'invitation-email-worker',
                    event: 'queue_tick',
                    processed: result.processed,
                    sent: result.sent,
                    failed: result.failed,
                }));
            }
        } catch (error) {
            console.error('[InvitationEmailWorker] Queue tick error:', error);
        }
    }

    public static start(intervalMs: number = 5000): void {
        if (invitationWorkerInterval) {
            return;
        }

        // Run immediately on start to clear any pending queue (e.g. after restart).
        this.processTick().catch((err) => {
            console.error('[InvitationEmailWorker] Initial tick error:', err);
        });

        invitationWorkerInterval = setInterval(() => {
            this.processTick().catch((err) => {
                console.error('[InvitationEmailWorker] Recurring tick error:', err);
            });
        }, intervalMs);

        console.log('[InvitationEmailWorker] Background invitation email worker initialized.');
    }

    public static stop(): void {
        if (invitationWorkerInterval) {
            clearInterval(invitationWorkerInterval);
            invitationWorkerInterval = null;
        }
    }
}

export default InvitationEmailWorker;
