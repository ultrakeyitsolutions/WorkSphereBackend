import { IAttendance } from '../attendance/attendance.model';
import { ITimeTracking, IntervalType } from '../task-tracking/time-tracking.model';
import { ITaskActivity, ActivityType } from '../task-activities/task-activity.model';
import {
    ProductivityMetrics,
    AnomalyRecord,
    AnomalyType,
    AnomalySeverity,
    OvertimeRecord,
    TimesheetHealthSummary,
    TimesheetHealthStatus,
    TimelineEntry,
    TimelineEventKind
} from './timesheet.types';

/** Default working hours per day for overtime calculation */
const DEFAULT_REGULAR_HOURS = 8;

/** Score deducted per anomaly severity */
const ANOMALY_DEDUCTIONS: Record<AnomalySeverity, number> = {
    [AnomalySeverity.HIGH]:   25,
    [AnomalySeverity.MEDIUM]: 15,
    [AnomalySeverity.LOW]:     5
};

// ─── TimesheetCalculatorService ──────────────────────────────────────────────

export class TimesheetCalculatorService {

    /**
     * Division-safe percentage helper.
     * Returns 0 when denominator is 0 or negative.
     * Result is clamped to [0, 100].
     */
    static safePercentage(numerator: number, denominator: number): number {
        if (!denominator || denominator <= 0) return 0;
        return Math.min(100, Math.max(0, (numerator / denominator) * 100));
    }

    /**
     * Convert milliseconds to hours (2 decimal places).
     */
    static msToHours(ms: number): number {
        return Math.round((ms / 3_600_000) * 100) / 100;
    }

    /**
     * Calculate productivity metrics for one user on one calendar day.
     *
     * Metric definitions (canonical):
     *   productionHours  = sum of all completed + in-progress WORK intervals
     *   breakHours       = sum of all BREAK intervals + sum of all HOLD intervals
     *   totalWorkHours   = attendance window (checkOut - checkIn, or now if still in)
     *   idleHours        = max(0, totalWorkHours - productionHours - breakHours)
     *   meetingHours     = 0  (no source exists)
     *   efficientHours   = 0  (no source exists; must NOT be derived from score)
     *   inefficientHours = 0  (no source exists; must NOT be derived from score)
     */
    static calculateDayMetrics(
        attendance: IAttendance | null,
        trackingSessions: ITimeTracking[],
        isProjectFiltered: boolean = false
    ): ProductivityMetrics {
        // If filtered by a specific project: calculate metrics directly from that project's sessions
        if (isProjectFiltered) {
            let productionMs = 0;
            let breakMs      = 0;

            for (const session of trackingSessions) {
                for (const interval of session.intervals) {
                    const start = interval.startedAt.getTime();
                    const end   = interval.endedAt
                        ? interval.endedAt.getTime()
                        : Date.now();
                    const durationMs = Math.max(0, end - start);

                    if (interval.type === IntervalType.WORK) {
                        productionMs += durationMs;
                    } else {
                        // IntervalType.BREAK and IntervalType.HOLD both map to breakHours
                        breakMs += durationMs;
                    }
                }
            }

            const productionHours = TimesheetCalculatorService.msToHours(productionMs);
            const breakHours      = TimesheetCalculatorService.msToHours(breakMs);
            const totalWorkHours  = Math.round((productionHours + breakHours) * 100) / 100;
            const overtime        = TimesheetCalculatorService.calculateOvertime(totalWorkHours);
            const productivityScore = totalWorkHours > 0
                ? TimesheetCalculatorService.safePercentage(productionHours, totalWorkHours)
                : 0;

            return {
                productionHours,
                breakHours,
                idleHours: 0,
                meetingHours: 0,
                efficientHours: 0,
                inefficientHours: 0,
                overtimeHours: overtime.overtimeHours,
                totalWorkHours,
                productivityScore,
                utilizationPercentage: productivityScore
            };
        }

        if (!attendance) {
            return TimesheetCalculatorService.zeroMetrics();
        }

        const checkIn  = attendance.checkInTime.getTime();
        const checkOut = attendance.checkOutTime
            ? attendance.checkOutTime.getTime()
            : Date.now(); // still checked in — measure up to now

        const totalWorkMs = Math.max(0, checkOut - checkIn);
        const totalWorkHours = TimesheetCalculatorService.msToHours(totalWorkMs);

        let productionMs = 0;
        let breakMs      = 0;

        for (const session of trackingSessions) {
            for (const interval of session.intervals) {
                const start = interval.startedAt.getTime();
                const end   = interval.endedAt
                    ? interval.endedAt.getTime()
                    : Date.now(); // still open interval
                const durationMs = Math.max(0, end - start);

                if (interval.type === IntervalType.WORK) {
                    productionMs += durationMs;
                } else {
                    // IntervalType.BREAK and IntervalType.HOLD both map to breakHours
                    breakMs += durationMs;
                }
            }
        }

        const productionHours = TimesheetCalculatorService.msToHours(productionMs);
        const breakHours      = TimesheetCalculatorService.msToHours(breakMs);
        const idleHours       = Math.max(
            0,
            Math.round((totalWorkHours - productionHours - breakHours) * 100) / 100
        );

        const productivityScore     = TimesheetCalculatorService.safePercentage(productionHours, totalWorkHours);
        const utilizationPercentage = TimesheetCalculatorService.safePercentage(productionHours, totalWorkHours);

        const overtime = TimesheetCalculatorService.calculateOvertime(totalWorkHours);

        return {
            productionHours,
            breakHours,
            idleHours,
            meetingHours: 0,
            efficientHours: 0,
            inefficientHours: 0,
            overtimeHours: overtime.overtimeHours,
            totalWorkHours,
            productivityScore,
            utilizationPercentage
        };
    }

    /**
     * Returns all-zero metrics. Used when an employee has no attendance record for a day.
     */
    static zeroMetrics(): ProductivityMetrics {
        return {
            productionHours: 0,
            breakHours: 0,
            idleHours: 0,
            meetingHours: 0,
            efficientHours: 0,
            inefficientHours: 0,
            overtimeHours: 0,
            totalWorkHours: 0,
            productivityScore: 0,
            utilizationPercentage: 0
        };
    }

    /**
     * Calculate overtime using a configurable regular-hours threshold.
     * Default regular hours = 8.
     */
    static calculateOvertime(totalWorkHours: number, regularHours = DEFAULT_REGULAR_HOURS): OvertimeRecord {
        const overtimeHours = Math.max(0, Math.round((totalWorkHours - regularHours) * 100) / 100);
        return { regularHours, overtimeHours, totalWorkHours };
    }

    /**
     * Detect anomalies for a single user-day.
     *
     * @param metrics    - Pre-calculated day metrics
     * @param attendance - Raw attendance record (may be null)
     * @param sessions   - Raw time tracking sessions for the day
     * @param activities - Raw task activities for the day
     * @param calendarDate - The ISO date string (YYYY-MM-DD) being evaluated
     */
    static detectAnomalies(
        metrics: ProductivityMetrics,
        attendance: IAttendance | null,
        sessions: ITimeTracking[],
        activities: ITaskActivity[],
        calendarDate: string,
        isProjectFiltered: boolean = false
    ): AnomalyRecord[] {
        const anomalies: AnomalyRecord[] = [];

        if (!attendance && !isProjectFiltered) return anomalies;

        const checkIn    = attendance?.checkInTime ?? (sessions[0]?.startedAt ?? new Date());
        const checkOut   = attendance?.checkOutTime;
        const now        = new Date();

        // ── MISSING_CHECKOUT ─────────────────────────────────────────────────
        // Checked in but no checkout and it is past end of that calendar day (only for whole-day attendance)
        const endOfDay = new Date(`${calendarDate}T23:59:59.999Z`);
        if (!isProjectFiltered && !checkOut && now > endOfDay) {
            anomalies.push({
                type: AnomalyType.MISSING_CHECKOUT,
                severity: AnomalySeverity.MEDIUM,
                title: 'Missing Check-Out',
                description: `Employee checked in at ${checkIn.toISOString()} but never checked out.`,
                timestamp: checkIn.toISOString()
            });
        }

        // ── LONG_BREAK ───────────────────────────────────────────────────────
        // Any single BREAK or HOLD interval > 60 minutes
        const LONG_BREAK_THRESHOLD_MS = 60 * 60 * 1000;
        for (const session of sessions) {
            for (const interval of session.intervals) {
                if (interval.type === IntervalType.WORK) continue;
                const start = interval.startedAt.getTime();
                const end   = interval.endedAt ? interval.endedAt.getTime() : Date.now();
                const durationMs = end - start;
                if (durationMs > LONG_BREAK_THRESHOLD_MS) {
                    const durationHours = TimesheetCalculatorService.msToHours(durationMs);
                    anomalies.push({
                        type: AnomalyType.LONG_BREAK,
                        severity: AnomalySeverity.MEDIUM,
                        title: 'Long Break / Hold',
                        description: `A ${interval.type.toLowerCase()} interval lasted ${durationHours.toFixed(1)} hours (threshold: 1h).`,
                        timestamp: interval.startedAt.toISOString(),
                        duration: durationHours,
                        taskId:    session.taskId?.toString() ?? null,
                        projectId: session.projectId?.toString() ?? null
                    });
                    break; // Report once per session — first offending interval
                }
            }
        }

        // ── EXCESSIVE_IDLE ───────────────────────────────────────────────────
        // idleHours > 50% of totalWorkHours, and totalWorkHours >= 1h (only for whole-day attendance)
        if (!isProjectFiltered && metrics.totalWorkHours >= 1 && metrics.idleHours > metrics.totalWorkHours * 0.5) {
            const pct = ((metrics.idleHours / metrics.totalWorkHours) * 100).toFixed(0);
            anomalies.push({
                type: AnomalyType.EXCESSIVE_IDLE,
                severity: AnomalySeverity.HIGH,
                title: 'Excessive Idle Time',
                description: `Employee was idle for ${metrics.idleHours.toFixed(1)}h out of ${metrics.totalWorkHours.toFixed(1)}h total (${pct}%).`,
                timestamp: checkIn.toISOString(),
                duration: metrics.idleHours
            });
        }

        // ── NO_TASK_ASSIGNED ─────────────────────────────────────────────────
        // Zero production hours while checked in >= 2 hours (only for whole-day attendance)
        if (!isProjectFiltered && metrics.productionHours === 0 && metrics.totalWorkHours >= 2) {
            anomalies.push({
                type: AnomalyType.NO_TASK_ASSIGNED,
                severity: AnomalySeverity.HIGH,
                title: 'No Task Worked',
                description: `Employee was checked in for ${metrics.totalWorkHours.toFixed(1)}h but logged no task work.`,
                timestamp: checkIn.toISOString(),
                duration: metrics.totalWorkHours
            });
        }

        // ── EXCESSIVE_HOURS ──────────────────────────────────────────────────
        // Total work exceeds 12 hours
        if (metrics.totalWorkHours > 12) {
            anomalies.push({
                type: AnomalyType.EXCESSIVE_HOURS,
                severity: AnomalySeverity.HIGH,
                title: 'Excessive Work Hours',
                description: `Employee logged ${metrics.totalWorkHours.toFixed(1)}h in a single day (threshold: 12h).`,
                timestamp: checkIn.toISOString(),
                duration: metrics.totalWorkHours
            });
        }

        // ── FREQUENT_PAUSE_RESUME ────────────────────────────────────────────
        // More than 5 TASK_PAUSED events in the day
        const pauseCount = activities.filter(a => a.type === ActivityType.TASK_PAUSED).length;
        if (pauseCount > 5) {
            anomalies.push({
                type: AnomalyType.FREQUENT_PAUSE_RESUME,
                severity: AnomalySeverity.LOW,
                title: 'Frequent Pause/Resume',
                description: `Task was paused ${pauseCount} times in this day (threshold: 5).`,
                timestamp: checkIn.toISOString()
            });
        }

        return anomalies;
    }

    /**
     * Derive a health summary from a list of anomalies.
     * Score starts at 100 and is reduced per anomaly severity.
     * Clamps to [0, 100].
     */
    static calculateHealthSummary(anomalies: AnomalyRecord[]): TimesheetHealthSummary {
        let score = 100;
        for (const anomaly of anomalies) {
            score -= ANOMALY_DEDUCTIONS[anomaly.severity];
        }
        score = Math.max(0, score);

        let status: TimesheetHealthStatus;
        if (score >= 75) {
            status = TimesheetHealthStatus.GOOD;
        } else if (score >= 50) {
            status = TimesheetHealthStatus.ATTENTION;
        } else {
            status = TimesheetHealthStatus.CRITICAL;
        }

        return { status, score, flags: anomalies.length };
    }

    /**
     * Build a chronological timeline of events for a single day.
     * Merges attendance check-in/out with task activity events.
     */
    static buildTimeline(
        attendance: IAttendance | null,
        activities: (ITaskActivity & { taskTitle?: string; projectName?: string })[],
    ): TimelineEntry[] {
        const entries: TimelineEntry[] = [];

        if (attendance) {
            entries.push({
                timestamp: attendance.checkInTime.toISOString(),
                kind: 'CHECK_IN',
                title: 'Checked In',
                description: 'Employee started the work day.'
            });

            if (attendance.checkOutTime) {
                entries.push({
                    timestamp: attendance.checkOutTime.toISOString(),
                    kind: 'CHECK_OUT',
                    title: 'Checked Out',
                    description: 'Employee ended the work day.'
                });
            }
        }

        const activityKindMap: Partial<Record<ActivityType, TimelineEventKind>> = {
            [ActivityType.TASK_STARTED]:   'TASK_STARTED',
            [ActivityType.TASK_PAUSED]:    'TASK_PAUSED',
            [ActivityType.TASK_RESUMED]:   'TASK_RESUMED',
            [ActivityType.TASK_HELD]:      'TASK_HELD',
            [ActivityType.TASK_COMPLETED]: 'TASK_COMPLETED',
            [ActivityType.TASK_CANCELLED]: 'TASK_CANCELLED'
        };

        const titleMap: Partial<Record<ActivityType, string>> = {
            [ActivityType.TASK_STARTED]:   'Task Started',
            [ActivityType.TASK_PAUSED]:    'Task Paused',
            [ActivityType.TASK_RESUMED]:   'Task Resumed',
            [ActivityType.TASK_HELD]:      'Task Held',
            [ActivityType.TASK_COMPLETED]: 'Task Completed',
            [ActivityType.TASK_CANCELLED]: 'Task Cancelled'
        };

        for (const activity of activities) {
            const kind = activityKindMap[activity.type];
            if (!kind) continue; // skip COMMENT, DOUBT, SYSTEM, etc.

            entries.push({
                timestamp: activity.createdAt.toISOString(),
                kind,
                title: titleMap[activity.type] ?? activity.type,
                description: activity.content ?? '',
                taskId:      activity.taskId?.toString() ?? null,
                taskTitle:   activity.taskTitle ?? null,
                projectId:   activity.projectId?.toString() ?? null,
                projectName: activity.projectName ?? null
            });
        }

        // Sort chronologically
        return entries.sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    }
}
