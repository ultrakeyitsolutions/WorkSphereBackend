import { describe, it, expect } from 'vitest';
import { IntervalUtil } from '../src/modules/performance/utils/interval.util';
import { DateRangeUtil } from '../src/modules/performance/utils/date-range.util';
import { ProductivityService } from '../src/modules/performance/services/productivity.service';

describe('User Performance Review Module Unit Tests', () => {
    describe('IntervalUtil - O(n log n) Overlap Resolution', () => {
        it('should return empty list when input is empty', () => {
            expect(IntervalUtil.mergeIntervals([])).toEqual([]);
        });

        it('should correctly merge overlapping time blocks', () => {
            const t1 = new Date('2026-09-16T09:00:00Z');
            const t2 = new Date('2026-09-16T11:00:00Z');
            const t3 = new Date('2026-09-16T10:30:00Z');
            const t4 = new Date('2026-09-16T12:00:00Z');

            const merged = IntervalUtil.mergeIntervals([
                { start: t1, end: t2 }, // 09:00 to 11:00
                { start: t3, end: t4 }, // 10:30 to 12:00
            ]);

            expect(merged).toHaveLength(1);
            expect(merged[0].start).toEqual(t1);
            expect(merged[0].end).toEqual(t4);
        });

        it('should calculate net minutes accurately without double counting overlaps', () => {
            const t1 = new Date('2026-09-16T09:00:00Z');
            const t2 = new Date('2026-09-16T11:00:00Z'); // 2 hours
            const t3 = new Date('2026-09-16T10:30:00Z');
            const t4 = new Date('2026-09-16T12:00:00Z'); // 1.5 hours (overlap 30 mins)

            const netMinutes = IntervalUtil.calculateNetMinutes([
                { start: t1, end: t2 },
                { start: t3, end: t4 },
            ]);

            // 09:00 to 12:00 = 3 hours = 180 minutes
            expect(netMinutes).toBe(180);
        });
    });

    describe('DateRangeUtil - Timezone Aware Date Calculation', () => {
        it('should default to this_month if range is not provided', () => {
            const period = DateRangeUtil.resolvePeriod({});
            expect(period.range).toBe('this_month');
            expect(period.from).toBeInstanceOf(Date);
            expect(period.to).toBeInstanceOf(Date);
        });

        it('should compute valid boundaries for today, yesterday, this_week', () => {
            const today = DateRangeUtil.resolvePeriod({ range: 'today' });
            expect(today.from.getHours()).toBe(0);
            expect(today.to.getHours()).toBe(23);

            const yesterday = DateRangeUtil.resolvePeriod({ range: 'yesterday' });
            expect(yesterday.from.getTime()).toBeLessThan(today.from.getTime());
        });
    });

    describe('ProductivityService - Deterministic Scoring', () => {
        it('should calculate normalized 0-100 score for high performance user', () => {
            const result = ProductivityService.calculateScore(
                { totalDaysInRange: 20, checkedInDays: 20, totalCheckedInMinutes: 9600, averageCheckedInMinutesPerDay: 480 },
                { totalTrackedMinutes: 9000, workMinutes: 8500, breakMinutes: 300, holdMinutes: 200, netProductiveMinutes: 8400, avgDailyTrackedMinutes: 450 },
                { totalAssigned: 10, completed: 9, inProgress: 1, pending: 0, overdue: 0, completionRatePercentage: 90 }
            );

            expect(result.score).toBeGreaterThanOrEqual(85);
            expect(result.rating).toBe('EXCELLENT');
            expect(result.breakdown.productionScore).toBeGreaterThan(0);
        });

        it('should return 0 score gracefully for zero-activity user without NaN or errors', () => {
            const result = ProductivityService.calculateScore(
                { totalDaysInRange: 20, checkedInDays: 0, totalCheckedInMinutes: 0, averageCheckedInMinutesPerDay: 0 },
                { totalTrackedMinutes: 0, workMinutes: 0, breakMinutes: 0, holdMinutes: 0, netProductiveMinutes: 0, avgDailyTrackedMinutes: 0 },
                { totalAssigned: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, completionRatePercentage: 0 }
            );

            expect(result.score).toBe(15); // Focus score is 100 when nonWorkRatio is 0
            expect(isNaN(result.score)).toBe(false);
            expect(result.rating).toBe('NEEDS_IMPROVEMENT');
        });
    });
});
