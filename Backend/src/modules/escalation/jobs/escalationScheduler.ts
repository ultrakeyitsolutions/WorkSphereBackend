import { Types } from 'mongoose';
import { getRedisClient } from '../../../config/redis';
import { EscalationCase } from '../models/EscalationCase';
import { EscalationRule } from '../models/EscalationRule';
import { EscalationLock } from '../models/EscalationLock';
import {
    EscalationCategory,
    EscalationCaseStatus,
    EscalationSourceModule,
    EscalationAuditAction,
} from '../constants/escalation.constants';
import { EscalationEngine } from '../services/EscalationEngine';
import { EscalationAuditService } from '../services/EscalationAuditService';
import { NotificationEventBus } from '../../notifications/notification.event-bus';
import Attendance from '../../attendance/attendance.model';
import AttendanceEvent from '../../attendance/attendance-event.model';
import { AttendanceEventType } from '../../attendance/attendance.types';
import CompanySettings from '../../companyadmin/settings/company-settings.model';
import Company from '../../super-admin/companies/company.model';

let schedulerInterval: NodeJS.Timeout | null = null;
let isJobRunning = false;
const inMemoryReminderCache = new Map<string, number>();

export interface JobExecutionStats {
    scanned: number;
    created: number;
    duplicateSkipped: number;
    exempted: number;
    failed: number;
}

export class EscalationSchedulerJob {
    private static currentLockOwner: string | null = null;
    private static currentLockTier: 'redis' | 'mongo' | 'memory' | null = null;

    /**
     * Acquire a distributed lock.
     * Tier 1: Redis atomic SET key owner EX ttl NX (fast, multi-instance)
     * Tier 2: MongoDB EscalationLock atomic findOneAndUpdate (multi-instance fallback)
     * Tier 3: In-memory fallback (single instance fallback)
     */
    public static async acquireLock(lockKey: string, ttlSeconds: number = 55): Promise<boolean> {
        const ownerToken = `${process.pid}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        // Tier 1: Redis distributed lock
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                const acquired = await redis.set(lockKey, ownerToken, 'EX', ttlSeconds, 'NX');
                if (acquired === 'OK') {
                    this.currentLockOwner = ownerToken;
                    this.currentLockTier = 'redis';
                    return true;
                }
                // Redis is active and lock is currently held by another node
                return false;
            }
        } catch {
            // Redis unavailable - proceed to Tier 2 MongoDB lock
        }

        // Tier 2: MongoDB atomic distributed lock
        try {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

            const lockDoc = await EscalationLock.findOneAndUpdate(
                {
                    lockKey,
                    $or: [
                        { expiresAt: { $lte: now } }, // Lock expired from crashed instance
                        { owner: ownerToken },
                    ],
                },
                {
                    $set: {
                        lockKey,
                        owner: ownerToken,
                        expiresAt,
                        acquiredAt: now,
                    },
                },
                {
                    upsert: true,
                    new: true,
                }
            );

            if (lockDoc && lockDoc.owner === ownerToken) {
                this.currentLockOwner = ownerToken;
                this.currentLockTier = 'mongo';
                return true;
            }
            return false;
        } catch (mongoErr: any) {
            // E11000 duplicate key error means an active unexpired lock exists for another instance
            if (mongoErr?.code === 11000 || mongoErr?.message?.includes('E11000')) {
                return false;
            }
            // Fall through to Tier 3 if MongoDB lock collection is inaccessible
        }

        // Tier 3: Local process in-memory lock
        if (isJobRunning) return false;
        isJobRunning = true;
        this.currentLockOwner = ownerToken;
        this.currentLockTier = 'memory';
        return true;
    }

    /**
     * Release lock safely verifying ownership
     */
    public static async releaseLock(lockKey: string): Promise<void> {
        const owner = this.currentLockOwner;
        const tier = this.currentLockTier;
        this.currentLockOwner = null;
        this.currentLockTier = null;
        isJobRunning = false;

        if (!owner) return;

        if (tier === 'redis') {
            // Release Tier 1 Redis lock safely (owner verification)
            try {
                const redis = getRedisClient();
                if (redis && redis.status === 'ready') {
                    const luaScript = `
                        if redis.call("get", KEYS[1]) == ARGV[1] then
                            return redis.call("del", KEYS[1])
                        else
                            return 0
                        end
                    `;
                    await redis.eval(luaScript, 1, lockKey, owner);
                }
            } catch {
                // Ignored
            }
        } else if (tier === 'mongo') {
            // Release Tier 2 MongoDB lock safely
            try {
                await EscalationLock.deleteOne({ lockKey, owner });
            } catch {
                // Ignored
            }
        }
    }

    /**
     * Check if a case reminder should be sent (prevents duplicate spam every minute)
     */
    private static async shouldSendReminder(key: string, ttlSeconds: number = 6 * 3600): Promise<boolean> {
        try {
            const redis = getRedisClient();
            if (redis && redis.status === 'ready') {
                const acquired = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
                return acquired === 'OK';
            }
        } catch {
            // Fall through to memory cache
        }

        const now = Date.now();
        const expiresAt = inMemoryReminderCache.get(key);
        if (expiresAt && now < expiresAt) {
            return false;
        }
        inMemoryReminderCache.set(key, now + ttlSeconds * 1000);

        // Prune old entries
        if (inMemoryReminderCache.size > 1000) {
            for (const [k, exp] of inMemoryReminderCache.entries()) {
                if (now >= exp) inMemoryReminderCache.delete(k);
            }
        }
        return true;
    }

    /**
     * Main execution tick running all scheduled detection passes.
     */
    public static async processAll(): Promise<void> {
        const lockKey = 'lock:escalation:scheduler';
        const acquired = await this.acquireLock(lockKey, 55);
        if (!acquired) {
            console.log('[EscalationSchedulerJob] Lock already held by another instance/job. Skipping tick.');
            return;
        }

        try {
            // 1. Scan for missing check-outs
            await this.detectMissingCheckouts();

            // 2. Scan for exceeded active breaks
            await this.detectExceededBreaks();

            // 3. Scan for pending case reminders & approaching resolution deadlines
            await this.processCaseReminders();
        } catch (error) {
            console.error('[EscalationSchedulerJob] Error in scheduler execution:', error);
        } finally {
            await this.releaseLock(lockKey);
        }
    }

    /**
     * Detect shifts that have ended where employees checked in but never checked out.
     */
    public static async detectMissingCheckouts(): Promise<JobExecutionStats> {
        const stats: JobExecutionStats = { scanned: 0, created: 0, duplicateSkipped: 0, exempted: 0, failed: 0 };
        try {
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];

            // Find attendances where checkIn exists, lastCheckOut is null, shift concluded > 1 hour ago
            const unclosedAttendances = await Attendance.find({
                date: { $lte: todayStr },
                'actual.firstCheckIn': { $ne: null },
                'actual.lastCheckOut': null,
                'scheduled.endTime': { $ne: null, $lt: new Date(now.getTime() - 60 * 60 * 1000) },
                isFinalized: false,
            })
                .limit(50)
                .lean();

            stats.scanned = unclosedAttendances.length;

            for (const att of unclosedAttendances) {
                const cycleDate = att.date || (att.scheduled?.startTime ? new Date(att.scheduled.startTime).toISOString().split('T')[0] : todayStr);
                const deterministicKey = `missing_checkout_${att._id.toString()}`;

                const result = await EscalationEngine.getInstance().publishEvent({
                    companyId: att.companyId.toString(),
                    employeeId: att.employeeId.toString(),
                    category: EscalationCategory.PRODUCTION_HOURS_DISCREPANCY,
                    sourceModule: EscalationSourceModule.ATTENDANCE,
                    sourceRecordId: att._id.toString(),
                    eventTimestamp: att.scheduled?.endTime || now,
                    eventDate: cycleDate,
                    expectedValue: att.scheduled?.endTime ? new Date(att.scheduled.endTime).toISOString() : 'Shift End',
                    actualValue: 'Missing Check-Out',
                    violationDuration: 60,
                    metadata: {
                        attendanceId: att._id.toString(),
                        cycleDate,
                        scheduledStart: att.scheduled?.startTime,
                        scheduledEnd: att.scheduled?.endTime,
                    },
                    idempotencyKey: deterministicKey,
                });

                if (result.caseCreated) {
                    stats.created++;
                } else if (result.exempted) {
                    stats.exempted++;
                } else if (result.processed) {
                    stats.duplicateSkipped++;
                } else {
                    stats.failed++;
                }
            }

            console.log('[EscalationSchedulerJob] detectMissingCheckouts completed', JSON.stringify({
                action: 'MISSING_CHECKOUT_SCAN_COMPLETE',
                ...stats,
            }));
        } catch (error) {
            console.error('[EscalationSchedulerJob] detectMissingCheckouts error:', error);
        }
        return stats;
    }

    /**
     * Detect open breaks exceeding the maximum break duration limit.
     */
    public static async detectExceededBreaks(): Promise<JobExecutionStats> {
        const stats: JobExecutionStats = { scanned: 0, created: 0, duplicateSkipped: 0, exempted: 0, failed: 0 };
        try {
            const now = new Date();
            // Look for BREAK_START events in the last 24 hours that have no corresponding BREAK_END
            const recentBreakStarts = await AttendanceEvent.find({
                type: AttendanceEventType.BREAK_START,
                timestamp: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            })
                .limit(100)
                .lean();

            stats.scanned = recentBreakStarts.length;

            for (const bStart of recentBreakStarts) {
                // Check if a subsequent BREAK_END exists for this attendance
                const bEnd = await AttendanceEvent.findOne({
                    attendanceId: bStart.attendanceId,
                    type: AttendanceEventType.BREAK_END,
                    timestamp: { $gt: bStart.timestamp },
                }).lean();

                if (!bEnd) {
                    const elapsedMinutes = Math.floor((now.getTime() - new Date(bStart.timestamp).getTime()) / 60000);
                    // If break duration has been open for more than 60 minutes, evaluate escalation
                    if (elapsedMinutes >= 60) {
                        const eventDate = bStart.timestamp
                            ? new Date(bStart.timestamp).toISOString().split('T')[0]
                            : now.toISOString().split('T')[0];

                        const result = await EscalationEngine.getInstance().publishEvent({
                            companyId: bStart.companyId.toString(),
                            employeeId: bStart.employeeId.toString(),
                            category: EscalationCategory.BREAK_TIME_EXCEEDED,
                            sourceModule: EscalationSourceModule.ATTENDANCE,
                            sourceRecordId: bStart._id.toString(),
                            eventTimestamp: now,
                            eventDate,
                            expectedValue: 'Max 60m break',
                            actualValue: `${elapsedMinutes}m active break`,
                            violationDuration: elapsedMinutes - 60,
                            metadata: {
                                breakStartEventId: bStart._id.toString(),
                                attendanceId: bStart.attendanceId?.toString(),
                            },
                            idempotencyKey: `exceeded_break_${bStart._id.toString()}`,
                        });

                        if (result.caseCreated) {
                            stats.created++;
                        } else if (result.exempted) {
                            stats.exempted++;
                        } else if (result.processed) {
                            stats.duplicateSkipped++;
                        } else {
                            stats.failed++;
                        }
                    }
                }
            }

            console.log('[EscalationSchedulerJob] detectExceededBreaks completed', JSON.stringify({
                action: 'EXCEEDED_BREAKS_SCAN_COMPLETE',
                ...stats,
            }));
        } catch (error) {
            console.error('[EscalationSchedulerJob] detectExceededBreaks error:', error);
        }
        return stats;
    }

    /**
     * Process resolution deadline reminders and overdue warnings for pending escalation cases.
     */
    public static async processCaseReminders(): Promise<void> {
        try {
            const now = new Date();
            const sixHoursAhead = new Date(now.getTime() + 6 * 60 * 60 * 1000);

            // Find pending or under_review cases whose deadline is approaching within 6 hours
            const urgentCases = await EscalationCase.find({
                status: {
                    $in: [
                        EscalationCaseStatus.PENDING,
                        EscalationCaseStatus.UNDER_REVIEW,
                        EscalationCaseStatus.AWAITING_EMPLOYEE,
                    ],
                },
                dueAt: { $lte: sixHoursAhead },
            })
                .limit(50)
                .lean();

            for (const c of urgentCases) {
                const isOverdue = new Date(c.dueAt).getTime() < now.getTime();
                const reminderKey = `reminder:escalation:${c._id.toString()}:${isOverdue ? 'overdue' : 'urgent'}`;

                // Deduplicate reminders: do not re-send if already reminded within last 6 hours
                const shouldSend = await this.shouldSendReminder(reminderKey, 6 * 3600);
                if (!shouldSend) {
                    continue;
                }

                const targetRecipients = (c.notifiedUsers || []).map((u) => u.userId.toString());

                if (targetRecipients.length > 0) {
                    NotificationEventBus.getInstance().publish({
                        type: 'ESCALATION_REMINDER',
                        companyId: c.companyId.toString(),
                        actorId: c.employeeId.toString(),
                        entityId: c._id.toString(),
                        entityType: 'ESCALATION',
                        recipientIds: targetRecipients,
                        actionUrl: `/companyadmin/escalations?caseId=${c._id.toString()}`,
                        metadata: {
                            caseId: c._id.toString(),
                            category: c.category,
                            status: c.status,
                            isOverdue,
                            dueAt: c.dueAt,
                        },
                        priority: isOverdue ? 'CRITICAL' : 'HIGH',
                    });

                    console.log('[EscalationSchedulerJob] Case reminder dispatched', JSON.stringify({
                        action: 'REMINDER_DISPATCHED',
                        caseId: c._id.toString(),
                        isOverdue,
                        recipientCount: targetRecipients.length,
                    }));
                }
            }
        } catch (error) {
            console.error('[EscalationSchedulerJob] processCaseReminders error:', error);
        }
    }

    /**
     * Start the background scheduler
     */
    public static start(intervalMs: number = 60 * 1000): void {
        if (schedulerInterval) return;

        // Run initial tick safely
        this.processAll().catch((err) => {
            console.error('[EscalationSchedulerJob] Initial tick error:', err);
        });

        schedulerInterval = setInterval(() => {
            this.processAll().catch((err) => {
                console.error('[EscalationSchedulerJob] Interval tick error:', err);
            });
        }, intervalMs);

        console.log('[EscalationSchedulerJob] Background escalation compliance scheduler initialized.');
    }

    /**
     * Stop the scheduler (for testing or graceful teardown)
     */
    public static stop(): void {
        if (schedulerInterval) {
            clearInterval(schedulerInterval);
            schedulerInterval = null;
        }
        isJobRunning = false;
        this.currentLockOwner = null;
    }
}
export default EscalationSchedulerJob;
